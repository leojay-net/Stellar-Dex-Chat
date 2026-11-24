# ADR-003: Offline Message Queue and IndexedDB Storage Architecture

## Status

Accepted

## Context

DexFiat combines natural language AI conversations with financial conversions and blockchain transactions on the Stellar network. Users frequently operate in conditions with transient or unstable connectivity, such as mobile networks, intermittent WiFi, or temporary RPC node outages.

In a naive chat implementation, sending a message during a network interruption results in immediate request failure, dropped messages, lost user inputs, and confusion regarding whether a transaction or prompt was submitted. Because messages may initiate offramp workflows, dropping requests or repeating them without deduplication introduces operational risk.

To deliver a reliable user experience, the frontend requires an offline queue mechanism that:
1. Buffers outgoing chat messages when the user is disconnected.
2. Persists queued messages across page reloads and browser sessions.
3. Automatically replays queued messages in chronological order when network connectivity returns.
4. Updates UI indicators (e.g., `OfflineStatusBanner`, pending message badges) reactively.

---

## Decision

We use **IndexedDB** as the persistent backing store for the offline message queue (implemented in `src/lib/offlineMessageQueue.ts`), paired with an in-memory execution queue in `src/lib/networkQueue.ts` and queue orchestration in `src/hooks/useChat.ts`.

### Why IndexedDB Instead of localStorage?

While `localStorage` is simpler to implement, it was rejected for the message queue in favor of `IndexedDB` due to several fundamental architectural factors:

1. **Structured Storage**:
   - `IndexedDB` natively stores complex JavaScript objects (including nested metadata, timestamps, and state machine snapshots) via the structured clone algorithm.
   - `localStorage` only supports UTF-16 DOMString key-value pairs, requiring expensive, lossy JSON serialization/deserialization on every read and write.

2. **Asynchronous Non-Blocking Operations**:
   - `IndexedDB` operations (`open`, `transaction`, `put`, `get`, `delete`) are completely asynchronous and event-driven.
   - `localStorage` is strictly synchronous and blocks the browser's main thread during disk I/O, which risks frame drops, input latency, and UI freezing during intensive queue read/writes.

3. **Storage Capacity**:
   - `localStorage` is strictly capped at 5–10 MB per origin across most modern browsers.
   - `IndexedDB` provides substantially larger capacity (typically hundreds of megabytes to gigabytes, subject to disk availability), ensuring the queue never conflicts with other client caches or telemetry logs.

4. **Transaction Support**:
   - `IndexedDB` provides ACID transactional guarantees (`readonly` and `readwrite` modes). Updates to queue records either commit completely or abort cleanly without leaving corrupted intermediate state.
   - `localStorage` lacks transactions; a browser crash or tab termination mid-write can leave incomplete strings.

5. **Queue Persistence & Durability**:
   - `IndexedDB` reliably persists structured message records across browser tab closures, hard refreshes, and device reboots, allowing offline queues created in one session to be restored and replayed in a subsequent session.

---

## Technical Design & Implementation

### Database Schema

The database configuration in `src/lib/offlineMessageQueue.ts` is defined as:
- **Database Name**: `dechat-offline-queue`
- **Schema Version**: `1`
- **Object Store Name**: `queued-messages`
- **Key Path**: `id` (string, corresponding to `optimisticUserId`)

#### Record Interface (`QueuedMessageRecord`)

```typescript
export interface QueuedMessageRecord {
  id: string;                  // Unique identifier (optimistic user message ID)
  content: string;             // Text content of the prompt
  optimisticUserId: string;    // Client-generated optimistic message ID
  pendingAssistantId: string;  // Placeholder ID for expected assistant reply
  machineSnapshot: unknown;    // Chat state machine snapshot at enqueue time
  queuedAt: number;            // Unix epoch timestamp (milliseconds)
}
```

### SSR Safety Guard

`offlineMessageQueue.ts` guards all database access using:
```typescript
function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
```
During Next.js server-side rendering (SSR), all operations resolve safely without throwing or causing hydration mismatches.

---

## Queue Ordering & Replay Behavior

The queue lifecycle is orchestrated cooperatively between `offlineMessageQueue.ts`, `networkQueue.ts`, and `useChat.ts`:

```
User Sends Message
        │
        ▼
Is Browser Online? ─── No ───► 1. Push to in-memory `queuedSendsRef`
        │                       2. Persist to IndexedDB (`addQueuedMessage`)
       Yes                      3. Set UI queue count (`setQueuedMessageCount`)
        │
        ▼
Attempt Send / API Call
        │
    Success? ──────── Yes ───► Remove from IndexedDB & update UI
        │
        No (Network Error)
        │
        ▼
1. Push to in-memory `queuedSendsRef`
2. Persist to IndexedDB (`addQueuedMessage`)
3. Await Reconnection (`window.addEventListener('online')`)
```

### 1. Enqueue Behavior
- If `!window.navigator.onLine` when the user submits a message, `useChat` assigns an `optimisticUserId` and creates a `QueuedMessageRecord` stamped with `queuedAt: Date.now()`.
- The record is appended to the runtime array `queuedSendsRef` and written to IndexedDB via `addQueuedMessage(record)`.
- The UI reactive count is refreshed via `setQueuedMessageCount(...)`, displaying the `OfflineStatusBanner`.

### 2. Session Restoration on Mount
- On component mount, `useChat` queries `getAllQueuedMessages()`.
- If stored records exist from a previous session or page reload while offline, they are retrieved and explicitly sorted chronologically:
  ```typescript
  records.sort((a, b) => a.queuedAt - b.queuedAt);
  ```
- The sorted records are loaded into `queuedSendsRef` to guarantee First-In-First-Out (FIFO) replay.

### 3. Reconnection & Replay
- When the browser emits the `window` `'online'` event, `useChat` triggers `replayQueuedSends()`.
- Messages are processed sequentially from the head of the queue (`shift()`):
  1. `analyzeAndRespond` is invoked with the message content and preserved state snapshot.
  2. On success: `removeQueuedMessage(queued.optimisticUserId)` deletes the record from IndexedDB, and the queue counter decrements.
  3. If a network interruption occurs mid-replay: the item is placed back at the beginning of the queue (`queuedSendsRef.current.unshift(queued)`), and replay halts until the next `'online'` event.

---

## Retry Strategy

Retry logic operates across two tiers:

1. **Ephemeral Read & API Request Queue (`networkQueue.ts`)**:
   - `withNetworkReadQueue(task, name)` wraps network queries.
   - **Retry Limit**: `MAX_RETRY = 5`.
   - **Network Error Detection**: `isNetworkError(error)` checks `!window.navigator.onLine` or matches error messages containing `"failed to fetch"`, `"network request failed"`, `"networkerror"`, `"offline"`, or `"timed out"`.
   - If an error is categorized as a network failure and `attempts < MAX_RETRY`, `attempts` is incremented and the task is re-queued.
   - Upon final failure (`attempts >= MAX_RETRY` or non-network error), the task rejects and dispatches an error toast: `"Could not send. Please try again."`.

2. **Persistent Chat Replay (`useChat.ts`)**:
   - During replay, transient network errors halt processing without dropping the message.
   - Non-network errors (e.g., API validation errors or 4xx responses) log `"Chat replay error"`, call `markMessageFailed(...)`, remove the message from IndexedDB, and transition the state machine to `ChatEvent.ENCOUNTER_ERROR`.

---

## Conflict Resolution & Idempotency

1. **Unique Message Deduplication**:
   - The IndexedDB store uses `keyPath: 'id'`, populated with `optimisticUserId`.
   - Calling `addQueuedMessage` executes `store.put(record)`. If a record with the same ID already exists, it is overwritten rather than duplicated, preventing duplicate queue entries.

2. **Sequential FIFO Processing**:
   - Replaying strictly one message at a time prevents out-of-order execution against the conversational backend and ensures prompt context continuity.

3. **State Machine Snapshots**:
   - Each queued record stores `machineSnapshot`, preserving the chat state at the moment the message was composed.

---

## Failure Modes & Mitigations

| Failure Mode | Root Cause | Impact | Current Mitigation / Handling |
|---|---|---|---|
| **IndexedDB Quota Exhaustion** | Device storage full or origin quota exceeded. | `tx.onerror` fires with `QuotaExceededError`. `put` rejects. | Promise rejection is caught; message remains in runtime `queuedSendsRef` in-memory. Persistent storage is unavailable until space clears. |
| **Blocked Database Upgrades** | Multiple browser tabs open during a schema version bump. | `request.onblocked` or stuck connection. | Currently `DB_VERSION = 1`. Future schema updates must implement `onversionchange` handlers to close existing connections gracefully. |
| **Database Initialization Failures** | Private browsing restrictions (e.g., legacy Safari/Firefox) or disabled storage. | `indexedDB.open()` rejects or throws security error. | `openDb()` rejects; `getAllQueuedMessages()` catches or returns `[]`. App operates using in-memory queue fallback without crashing. |
| **Transaction Failures** | Tab closed mid-transaction or transaction timeout. | Unfinished transaction aborts automatically. | IndexedDB atomicity prevents partial record writes. The record remains absent or intact. |
| **Network Interruption Mid-Send** | Connection drops during HTTP request transmission. | Request fails; error is caught by `isLikelyNetworkError()`. | Item is prepended back to `queuedSendsRef` via `unshift()`; removed from IndexedDB only after server confirmation. |
| **Retry Exhaustion** | Persistent backend failure or invalid payload. | Retries exceed limits or non-network error occurs. | Message marked as failed in UI; removed from queue; state machine transitions to `ERROR`. |

---

## Consequences

### Positive Consequences
- **Zero Message Loss**: Users can continue drafting and submitting messages while offline without fear of losing typed content.
- **Session Durability**: Pending messages survive page refreshes, accidental navigation, and browser restarts.
- **Clean Separation of Concerns**: `offlineMessageQueue.ts` is a modular, standalone storage service independent of React UI rendering.
- **Smooth UX**: Automatic replay on reconnect eliminates manual user retry overhead.

### Limitations & Unresolved Considerations

As documented from the code:
1. **Manual Queue Count Tracking**:
   - `offlineMessageQueue.ts` maintains an in-memory `currentCount` variable updated via `setQueuedMessageCount(...)`. It is not automatically synchronized with the actual count of records in IndexedDB without an explicit `getAllQueuedMessages()` call.
2. **Cross-Tab Synchronization**:
   - Count listeners (`subscribeToQueuedMessageCount`) operate strictly in the current window context. Queuing a message in Tab A does not trigger notifications in Tab B because `BroadcastChannel` or `window.addEventListener('storage')` is not implemented for IndexedDB changes.
3. **Absence of Background Sync API**:
   - Message replay requires an open application tab. If the user closes the browser before reconnection, messages remain stored in IndexedDB but will not be transmitted in the background via Service Worker Background Sync.
4. **State Machine Snapshot Drift**:
   - If an account state or external balance changes while offline, replaying an old `machineSnapshot` could encounter conflicts if the backend state diverges significantly.
