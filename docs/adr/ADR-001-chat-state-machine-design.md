# ADR-001: Chat State Machine Design

## Status

Accepted

## Context

The AI chat interface in DexFiat coordinates a multi-step user flow: message composition, AI intent analysis, clarification loops, and transaction execution. The naive approach of scattered boolean flags (`isLoading`, `isSending`, `isAwaitingClarification`, etc.) led to impossible state combinations and race conditions.

## Decision

We model the chat lifecycle as a deterministic finite-state machine with explicit states, events, guards, and side-effect actions.

## State Transition Diagram

```
                        ┌──────────────────────────────────────────────┐
                        │                                              │
                        v                                              │
                 ┌──────────────┐    SEND_MESSAGE    ┌──────────────┐  │
                 │  UNINITIALIZED│ ─────────────────> │  INITIALIZED │  │
                 └──────────────┘                     └──────────────┘  │
                        │                              │       │       │
                  INITIALIZE_SESSION           CLEAR_CHAT/LOAD_SESSION │
                        │                              │       │       │
                        v                              │       │       │
                 ┌──────────────┐                      │       │       │
                 │  INITIALIZED │ <─────────────────────┘       │       │
                 └──────────────┘                              │       │
                        │               ┌────────────────────────┘       │
                  SEND_MESSAGE          │                                │
                        │               │                                │
                        v               v                                │
                 ┌──────────────┐    SEND_MESSAGE                        │
                 │SENDING_MSG   │ ───────────────────────────────────────┘
                 └──────────────┘
                        │
              ┌─────────┼─────────────┐
              │         │             │
      ANALYSIS_COMPLETE │        ENCOUNTER_ERROR
              │    CANCEL_FLOW        │
              v         v             v
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ ANALYZING│ │CANCELLED │ │  ERROR   │
        └──────────┘ └──────────┘ └──────────┘
         │   │    │     │    │       │    │
         │   │    │     │    │       │    │
   ┌─────┘   │    │  RESET  │   RETRY_FROM_ERROR
   │  RECEIVE│    │  FLOW   │       │
   │  CLARIFI│    │    │    │       │
   │  CATION │    │    v    │       │
   │         │    │ INITIALIZED     │
   │         │    └─────────────────┘
   v         │
┌───┐  TRIGGER_TRANSACTION
│AWAIT│        │
│CLARIF│       v
└───┘   ┌──────────────┐
   │     │READY_FOR_TX  │
   │     └──────────────┘
   │            │
   │     TRANSACTION_INITIATED
   │            │
   │            v
   │     ┌──────────────┐
   │     │ TX_TRIGGERED │
   │     └──────────────┘
   │            │
   │     TRANSACTION_COMPLETED
   │            │
   │            v
   │     ┌──────────────┐
   └──── │AWAITING_USER │
         │   INPUT      │
         └──────────────┘
```

### States

| State | Purpose |
|---|---|
| `UNINITIALIZED` | Initial state before session setup |
| `INITIALIZED` | Session ready, awaiting first user message |
| `AWAITING_USER_INPUT` | Chat idle, waiting for user to type |
| `SENDING_MESSAGE` | Message submitted, awaiting AI response |
| `ANALYZING` | AI has responded; determining intent |
| `AWAITING_CLARIFICATION` | AI needs more info before proceeding |
| `READY_FOR_TRANSACTION` | Sufficient data collected; user can trigger |
| `TRANSACTION_TRIGGERED` | Transaction submitted to Stellar |
| `CANCELLED` | User or error aborted the flow |
| `ERROR` | Non-recoverable error occurred |

### Events

| Event | Trigger |
|---|---|
| `INITIALIZE_SESSION` | App mount or new session |
| `SEND_MESSAGE` | User submits chat message |
| `ANALYSIS_COMPLETE` | AI returns analysis |
| `RECEIVE_CLARIFICATION` | User responds to clarification prompt |
| `TRIGGER_TRANSACTION` | User confirms transaction |
| `TRANSACTION_INITIATED` | Contract call submitted to network |
| `TRANSACTION_COMPLETED` | Transaction confirmed on-chain |
| `ENCOUNTER_ERROR` | Any operation fails |
| `RETRY_FROM_ERROR` | User retries after error |
| `CANCEL_FLOW` | User cancels current operation |
| `RESET_FLOW` | Full flow reset to initial state |
| `CLEAR_CHAT` | Clear messages but keep session |
| `LOAD_SESSION` | Restore historical session |

### Guards

| Guard | Logic |
|---|---|
| `canTriggerTransaction` | `pendingTransactionData !== null && shouldProceed` |
| `hasTransactionData` | At least one of tokenIn/amountIn/fiatAmount is set |
| `hasReachedMessageThreshold` | `messageCount >= 3` |
| `shouldProceed` | Not cancelled by user |
| `canRecoverFromError` | `errorMessage !== null` |

## Consequences

1. Impossible states are eliminated by design (no invalid combinations)
2. State transitions are explicit and auditable
3. New flows can be added by extending states/events without refactoring existing transitions
4. Debugging is simplified via `formatChatStateSnapshot()` for clipboard-copyable state dumps
5. Guard functions encapsulate conditional logic, keeping transitions clean
