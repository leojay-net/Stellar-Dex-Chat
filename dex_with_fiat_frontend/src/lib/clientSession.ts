const CLIENT_SESSION_KEY = 'stellar_client_session_id';

export function getOrCreateClientSessionId() {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = window.sessionStorage.getItem(CLIENT_SESSION_KEY);
  if (existing) {
    return existing;
  }

  const nextId = crypto.randomUUID();
  window.sessionStorage.setItem(CLIENT_SESSION_KEY, nextId);
  return nextId;
}
