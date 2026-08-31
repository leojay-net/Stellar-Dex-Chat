# feat(frontend): API validation/rate-limiting + AuditTable ARIA live region

Closes #1177, #1274, #1277, #491

## Summary

Four related frontend reliability/accessibility tasks:

| Issue | Area | State before | Change |
| --- | --- | --- | --- |
| #1277 | `/api/payment-status/stream` | manual `sessionId` check, no rate limit | zod query validation + shared `applyRateLimit` + tests |
| #1274 | `/api/create-recipient` | zod + rate limit already applied | malformed-JSON → 400, dedicated route tests (incl. rejection paths) |
| #1177 | `AuditTable.tsx` | only the offline banner was announced | visually-hidden ARIA live region for loading / results / sort / errors |
| #491 | `ChatHistorySidebar.tsx` | optimistic UI already implemented & tested | added a list-level optimistic delete/undo regression test |

---

## #1277 — validate and rate-limit `payment-status/stream`

- `lib/apiSchemas.ts`: new `paymentStatusStreamQuerySchema` — `sessionId` must be a
  non-empty string, capped at 200 chars (the id is a UUID from `clientSession.ts`).
- `route.ts`:
  - `applyRateLimit(ip, '/api/payment-status/stream', { maxRequests: 60, windowMs: 60_000 })`
    runs first. The ceiling is deliberately generous: a single page opens several
    long-lived SSE connections (one per hook) and the browser's `EventSource`
    auto-reconnects on every network blip — the limit only exists to stop one IP
    hammering the endpoint.
  - `sessionId` is parsed through the schema; invalid input returns
    `400 { success: false, message: 'Validation failed', errors: [...] }`, the same
    machine-readable shape already used by `/api/events`.
- `route.test.ts` (new): missing `sessionId` → 400 + error shape, oversized
  `sessionId` → 400, valid → SSE stream opened, rate-limited → 429 (rejection path).

## #1274 — request validation & rate limiting for `create-recipient`

The route already parsed the body through `createRecipientSchema` and applied
`applyRateLimit`. Remaining gaps:

- `route.ts`: a malformed JSON body now returns
  `400 { success: false, message: 'Invalid JSON in request body.' }` instead of
  falling through to a generic `500` (mirrors `initiate-transfer`).
- `route.test.ts` (new): valid body succeeds, invalid body → 400 with a
  machine-readable `errors` array, malformed JSON → 400, **rate limiter → 429**,
  and the rate-limit bucket is namespaced to `/api/create-recipient`.

> Note: this route is `POST`-only with no query string, so the "query params
> through a zod schema" acceptance item does not apply here.

## #1177 — ARIA live-region announcements in `AuditTable`

- A visually-hidden (`sr-only`) `aria-live="polite" aria-atomic="true"` region is
  added. It is intentionally **role-free** so it never collides with the existing
  `role="status"` retry-queue banner (several tests assert there is at most one
  `status` node).
- It announces:
  - `Loading audit entries…` while a fetch is in flight
  - `Showing audit entries X to Y of Z. Sorted by <col>, <dir>.` once data settles
  - `No audit entries found. Try adjusting your filters. …` for an empty result
  - `Sorting by <col>, <dir>…` immediately on a header click (the settled message
    then supersedes it with the row range)
  - `Error loading audit entries: <message>` on failure
- The initial empty state is suppressed until the first fetch has started, so the
  region does not fire on mount.
- `prefers-reduced-motion`: the skeleton row gains `motion-reduce:animate-none`,
  matching the pattern already used in `Skeleton.tsx`.
- The region carries no colour, so it is inherently correct in both light and dark
  themes; no `ThemeContext` interaction was needed.

## #491 — optimistic UI in `ChatHistorySidebar`

Optimistic delete + undo, optimistic pin toggle with a bounce animation,
optimistic clear-all + undo, and the `sr-only` live region are all already
implemented in the component and covered by tests. Added one regression test
asserting that a deleted row disappears from the visible list immediately (before
`deleteSession` is called) and reappears on undo.

---

## Testing

Run from `Dechat/dex_with_fiat_frontend`:

```
pnpm typecheck   # clean
pnpm lint        # clean for all changed files
pnpm test:unit   # see note below
pnpm build       # succeeds
```

New / updated tests:

- `src/app/api/payment-status/stream/route.test.ts` (new)
- `src/app/api/create-recipient/route.test.ts` (new)
- `src/components/__tests__/AuditTable.test.tsx` (+6 cases)
- `src/components/__tests__/ChatHistorySidebar.test.tsx` (+1 case)

> Two pre-existing `AuditTable` tests (`shows a warning/success toast … offline`)
> fail locally on a clean `main` in this environment (real timers + `online`/
> `offline` events) and are unrelated to this change.

## Accessibility checklist (#1177)

- [x] Implemented without regressing existing behaviour
- [x] Works in light and dark themes (region is non-visual)
- [x] Respects `prefers-reduced-motion` (`motion-reduce:animate-none` on skeleton)
- [x] Unit tests cover the new behaviour
