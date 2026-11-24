/**
 * Represents a message draft stored in localStorage.
 *
 * @property content - The draft message content.
 * @property timestamp - Unix timestamp in milliseconds when the draft was saved.
 */
export interface Draft {
  content: string;
  timestamp: number;
}

const DRAFT_PREFIX = 'chat_draft_';
/** Default time-to-live for drafts in seconds (24 hours). */
const DEFAULT_TTL = 86400; // 24 hours in seconds

/**
 * Saves a message draft for a specific session to localStorage.
 *
 * This function persists a draft message for a given session ID, allowing users
 * to recover unsaved messages after page refreshes or navigation. If the content
 * is empty or whitespace-only, the draft is cleared instead of saved.
 *
 * @param sessionId - Unique identifier for the chat session. Used as part of the
 *   localStorage key to isolate drafts between different conversations.
 * @param content - The draft message content to save. Empty or whitespace-only
 *   content will result in clearing the draft instead.
 *
 * @returns void
 *
 * @throws Will log an error to console if localStorage is unavailable or quota
 *   is exceeded, but will not throw an exception to avoid disrupting the UI.
 *
 * @example
 * ```ts
 * // Save a draft for session 'user-123-chat-456'
 * saveDraft('user-123-chat-456', 'Hello, I have a question about...');
 *
 * // Clear draft by saving empty content
 * saveDraft('user-123-chat-456', '');
 * ```
 *
 * @see {@link getDraft} - Retrieve a saved draft
 * @see {@link clearDraft} - Explicitly clear a draft
 * @see {@link clearExpiredDrafts} - Clean up old drafts
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
  try {
    localStorage.setItem(`${DRAFT_PREFIX}${sessionId}`, JSON.stringify(draft));
  } catch (e) {
    console.error('Failed to save draft to localStorage', e);
  }
};

/**
 * Retrieves a message draft for a specific session, checking for expiry.
 *
 * This function fetches a draft from localStorage and validates that it has not
 * exceeded its time-to-live (TTL). Expired drafts are automatically cleared and
 * return null. This ensures users don't see stale drafts from old sessions.
 *
 * @param sessionId - Unique identifier for the chat session to retrieve the draft for.
 * @param ttlSeconds - Optional time-to-live in seconds. Defaults to 24 hours
 *   (86400 seconds). Drafts older than this are considered expired.
 *
 * @returns The draft content as a string if found and not expired, or null if
 *   no draft exists, it has expired, or an error occurred.
 *
 * @throws Will log an error to console if JSON parsing fails, but will not throw
 *   an exception to avoid disrupting the UI.
 *
 * @example
 * ```ts
 * // Get draft with default 24-hour TTL
 * const draft = getDraft('user-123-chat-456');
 * if (draft) {
 *   console.log('Recovered draft:', draft);
 * }
 *
 * // Get draft with custom 1-hour TTL
 * const recentDraft = getDraft('user-123-chat-456', 3600);
 * ```
 *
 * @see {@link saveDraft} - Save a draft
 * @see {@link clearDraft} - Explicitly clear a draft
 * @see {@link clearExpiredDrafts} - Clean up old drafts
 */
export const getDraft = (
  sessionId: string,
  ttlSeconds: number = DEFAULT_TTL,
): string | null => {
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
 * Clears a specific message draft from localStorage.
 *
 * This function removes the draft associated with a given session ID. This is
 * typically called after a message is successfully sent, when the user explicitly
 * discards a draft, or when saving empty content via {@link saveDraft}.
 *
 * @param sessionId - Unique identifier for the chat session whose draft should
 *   be cleared.
 *
 * @returns void
 *
 * @throws Will log an error to console if localStorage is unavailable, but will
 *   not throw an exception to avoid disrupting the UI.
 *
 * @example
 * ```ts
 * // Clear draft after sending message
 * sendMessage(message);
 * clearDraft('user-123-chat-456');
 *
 * // Clear draft when user discards it
 * onDiscardClick(() => {
 *   clearDraft('user-123-chat-456');
 * });
 * ```
 *
 * @see {@link saveDraft} - Save a draft
 * @see {@link getDraft} - Retrieve a saved draft
 * @see {@link clearExpiredDrafts} - Clean up old drafts
 */
export const clearDraft = (sessionId: string): void => {
  if (typeof window === 'undefined' || !sessionId) return;
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${sessionId}`);
  } catch (e) {
    console.error('Failed to clear draft from localStorage', e);
  }
};

/**
 * Clears all drafts that have expired based on their timestamp.
 *
 * This function iterates through all draft entries in localStorage and removes
 * those that have exceeded the specified time-to-live (TTL). It's useful for
 * cleanup operations to prevent localStorage bloat from accumulating old drafts.
 * Malformed draft entries are also removed to prevent parsing errors.
 *
 * @param ttlSeconds - Optional time-to-live in seconds. Defaults to 24 hours
 *   (86400 seconds). Drafts older than this are considered expired.
 *
 * @returns void
 *
 * @throws Will log an error to console if localStorage iteration fails, but will
 *   not throw an exception to avoid disrupting the UI.
 *
 * @example
 * ```ts
 * // Clean up expired drafts on app initialization
 * useEffect(() => {
 *   clearExpiredDrafts();
 * }, []);
 *
 * // Clean up drafts older than 1 hour
 * clearExpiredDrafts(3600);
 * ```
 *
 * @see {@link saveDraft} - Save a draft
 * @see {@link getDraft} - Retrieve a saved draft (also clears expired drafts)
 * @see {@link clearDraft} - Clear a specific draft
 */
export const clearExpiredDrafts = (ttlSeconds: number = DEFAULT_TTL): void => {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DRAFT_PREFIX)) {
      try {
        const item = localStorage.getItem(key);
        if (item) {
          const draft: Draft = JSON.parse(item);
          const expiryTime = draft.timestamp + ttlSeconds * 1000;
          if (now > expiryTime) {
            keysToRemove.push(key);
          }
        }
      } catch {
        keysToRemove.push(key!);
      }
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
};
