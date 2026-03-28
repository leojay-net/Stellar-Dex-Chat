export interface Draft {
  content: string;
  timestamp: number;
}

const DRAFT_PREFIX = 'chat_draft_';
const DEFAULT_TTL = 86400; // 24 hours in seconds

/**
 * Saves a message draft for a specific session.
 */
export const saveDraft = (sessionId: string, content: string): void => {
  if (typeof window === 'undefined' || !sessionId) return;
  
  if (!content.trim()) {
    clearDraft(sessionId);
    return;
  }

  const draft: Draft = {
    content,
    timestamp: Date.now(),
  };
  localStorage.setItem(`${DRAFT_PREFIX}${sessionId}`, JSON.stringify(draft));
};

/**
 * Retrieves a message draft for a specific session, checking for expiry.
 */
export const getDraft = (sessionId: string, ttlSeconds: number = DEFAULT_TTL): string | null => {
  if (typeof window === 'undefined' || !sessionId) return null;
  
  const item = localStorage.getItem(`${DRAFT_PREFIX}${sessionId}`);
  if (!item) return null;

  try {
    const draft: Draft = JSON.parse(item);
    const now = Date.now();
    const expiryTime = draft.timestamp + ttlSeconds * 1000;

    if (now > expiryTime) {
      clearDraft(sessionId);
      return null;
    }

    return draft.content;
  } catch (e) {
    console.error('Failed to parse draft', e);
    return null;
  }
};

/**
 * Clears a specific message draft.
 */
export const clearDraft = (sessionId: string): void => {
  if (typeof window === 'undefined' || !sessionId) return;
  localStorage.removeItem(`${DRAFT_PREFIX}${sessionId}`);
};

/**
 * Clears all drafts that have expired.
 */
export const clearExpiredDrafts = (ttlSeconds: number = DEFAULT_TTL): void => {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  const keys = Object.keys(localStorage);
  
  keys.forEach(key => {
    if (key.startsWith(DRAFT_PREFIX)) {
      try {
        const item = localStorage.getItem(key);
        if (item) {
          const draft: Draft = JSON.parse(item);
          const expiryTime = draft.timestamp + ttlSeconds * 1000;
          if (now > expiryTime) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        // Remove corrupted items
        localStorage.removeItem(key);
      }
    }
  });
};
