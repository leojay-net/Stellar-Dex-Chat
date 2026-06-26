# Pull Request: Frontend Bug Fixes — Memory Leaks, CSV Export, WebSocket Reconnect, Search Debounce

## Summary

- Fix polling interval memory leak in `useBridgeStats` (closes #962)
- Add CSV export to `AuditTable` for compliance reporting (closes #956)
- Add exponential backoff reconnect + stale-data indicator to `PriceTicker` (closes #949)
- Debounce search in `useChatHistory` to prevent per-keystroke API queries (closes #961)

## Changes

### fix(frontend): useBridgeStats polling interval cleanup — closes #962

`useBridgeStats.ts` already had `clearInterval` in the useEffect cleanup, but in-flight async requests could still update state after unmount. Added an `isMountedRef` guard so `refetchStats` short-circuits on every state-update call when the component is unmounted, eliminating the memory leak entirely.

**File:** `Dechat/dex_with_fiat_frontend/src/hooks/useBridgeStats.ts`

---

### feat(frontend): CSV export from AuditTable — closes #956

Added an **Export CSV** button to the filter bar in `AuditTable.tsx`. Clicking it:

1. Fetches all rows matching the current filters from `/api/admin-audit` (single request, up to 10 000 rows).
2. Builds the CSV string in 500-row chunks via `setTimeout(0)` so the UI remains responsive with large datasets.
3. Triggers a browser download with a filename that includes the active date range (e.g. `audit-log_2024-01-01_to_2024-03-31.csv`).

**File:** `Dechat/dex_with_fiat_frontend/src/components/AuditTable.tsx`

---

### fix(frontend): PriceTicker exponential backoff + stale-data indicator — closes #949

When a price fetch fails, `PriceTicker.tsx` now:

- Schedules a retry with exponential backoff (1 s → 2 s → 4 s … capped at 30 s), resetting on the next successful fetch.
- Shows a **yellow** status dot (instead of red) and a `"Prices may be stale — retrying…"` message while stale data from a previous successful fetch is displayed.
- Clears all retry timeouts on unmount to prevent memory leaks.

**File:** `Dechat/dex_with_fiat_frontend/src/components/PriceTicker.tsx`

---

### fix(frontend): debounce search in useChatHistory — closes #961

`useChatHistory.ts` now exposes `searchQuery`, `setSearchQuery`, and `searchResults`. Setting `searchQuery` triggers the session search only after a **300 ms** debounce, preventing a lookup (or future API call) on every keystroke. The existing `searchSessions` callback is preserved for one-shot use cases.

**File:** `Dechat/dex_with_fiat_frontend/src/hooks/useChatHistory.ts`

---

## Test plan

- [ ] `useBridgeStats`: Mount and quickly unmount the component while a fetch is in flight — confirm no React state-update warnings in the console.
- [ ] `AuditTable`: Apply filters, click **Export CSV**, verify the downloaded file contains all matching rows and the filename reflects the selected date range.
- [ ] `PriceTicker`: Simulate a network failure (DevTools → offline); confirm the yellow dot and retrying message appear, then restore connectivity and confirm the green dot and normal prices return.
- [ ] `useChatHistory` search: Type rapidly in the search box — confirm only one search fires per 300 ms pause, not on every character.
