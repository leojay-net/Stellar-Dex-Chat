const CLIENT_SESSION_KEY = 'stellar_client_session_id';

// In-memory fallback, shared across every call in this module instance.
//
// Root cause (#1227): `getOrCreateClientSessionId` read/wrote
// `sessionStorage` on every call with no memoization and no error handling.
// When `sessionStorage.setItem` throws (Safari private browsing, an
// exhausted storage quota, or a sandboxed iframe with storage access
// blocked), the id is generated but never persisted. Every subsequent call
// - across independent hooks (`useChat`, `usePaystackWebhookStatus`) and
// components (`BankDetailsModal`) that each call this function
// independently and assume they get back the *same* id for the lifetime of
// the tab - would then take the `!existing` branch again and mint a brand
// new id. The result: the SSE payment-status stream subscribes with one
// session id while the transfer request is tagged with a different one, so
// the two never correlate, and the failure is completely silent (no error
// surfaces anywhere).
//
// Fixed by caching the resolved id in module scope (a real, working
// "closure" instead of the previous stateless read-through) so that once an
// id is resolved for this page load - whether from storage or as an
// in-memory fallback - every caller keeps getting that same value, and by
// surfacing storage failures instead of swallowing them.
let cachedSessionId: string | null = null;

/**
 * Returns true if the last call to `getOrCreateClientSessionId` had to fall
 * back to an in-memory id because `sessionStorage` was unavailable or threw.
 * Callers that want to surface a user-visible warning (e.g. "your session
 * won't persist across a refresh") can check this after calling
 * `getOrCreateClientSessionId`.
 */
let lastCallUsedFallback = false;

export function clientSessionUsedFallbackStorage(): boolean {
  return lastCallUsedFallback;
}

export function getOrCreateClientSessionId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  if (cachedSessionId) {
    return cachedSessionId;
  }

  lastCallUsedFallback = false;

  let existing: string | null = null;
  try {
    existing = window.sessionStorage.getItem(CLIENT_SESSION_KEY);
  } catch (error) {
    lastCallUsedFallback = true;
    console.error(
      'getOrCreateClientSessionId: failed to read sessionStorage, falling back to an in-memory session id',
      error,
    );
  }

  if (existing) {
    cachedSessionId = existing;
    return existing;
  }

  const nextId = crypto.randomUUID();

  try {
    window.sessionStorage.setItem(CLIENT_SESSION_KEY, nextId);
  } catch (error) {
    lastCallUsedFallback = true;
    console.error(
      'getOrCreateClientSessionId: failed to persist session id to sessionStorage; it will not survive a page refresh',
      error,
    );
  }

  // Cache in memory regardless of whether persistence succeeded, so that
  // *this* page load stays consistent even if storage is unavailable.
  cachedSessionId = nextId;
  return nextId;
}
