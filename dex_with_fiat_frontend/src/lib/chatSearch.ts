import { ChatMessage, ChatSession } from '@/types';

export interface SearchFilters {
  keyword: string;
  walletAddress: string;
  dateFrom: string; // ISO date string YYYY-MM-DD
  dateTo: string;   // ISO date string YYYY-MM-DD
}

export interface MessageMatch {
  sessionId: string;
  sessionTitle: string;
  message: ChatMessage;
  /** Indices [start, end) of each keyword match within message.content */
  highlights: Array<[number, number]>;
}

export interface SearchResults {
  matches: MessageMatch[];
  totalSessions: number;
  totalMessages: number;
}

/** Debounce helper — returns a debounced version of `fn`. */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Finds all non-overlapping occurrences of `keyword` (case-insensitive)
 * in `text` and returns their [start, end) index pairs.
 */
export function findHighlights(text: string, keyword: string): Array<[number, number]> {
  if (!keyword.trim()) return [];
  const results: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  const lowerKw = keyword.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(lowerKw, pos);
    if (idx === -1) break;
    results.push([idx, idx + lowerKw.length]);
    pos = idx + lowerKw.length;
  }
  return results;
}

/**
 * Splits `text` into segments for rendering highlights.
 * Returns an array of `{ text, highlight }` objects.
 */
export function splitByHighlights(
  text: string,
  highlights: Array<[number, number]>,
): Array<{ text: string; highlight: boolean }> {
  if (!highlights.length) return [{ text, highlight: false }];

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;

  for (const [start, end] of highlights) {
    if (cursor < start) {
      segments.push({ text: text.slice(cursor, start), highlight: false });
    }
    segments.push({ text: text.slice(start, end), highlight: true });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }

  return segments;
}

/** Returns true when the message timestamp falls within [dateFrom, dateTo] (inclusive). */
function matchesDateRange(
  message: ChatMessage,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (!dateFrom && !dateTo) return true;
  const ts = new Date(message.timestamp).getTime();
  if (dateFrom) {
    const from = new Date(dateFrom).getTime();
    if (ts < from) return false;
  }
  if (dateTo) {
    // Include the full end day
    const to = new Date(dateTo).getTime() + 86_400_000 - 1;
    if (ts > to) return false;
  }
  return true;
}

/**
 * Searches all sessions for messages matching the given filters.
 * All non-empty filters are ANDed together.
 */
export function searchChatHistory(
  sessions: ChatSession[],
  filters: SearchFilters,
): SearchResults {
  const { keyword, walletAddress, dateFrom, dateTo } = filters;
  const hasKeyword = keyword.trim().length > 0;
  const hasWallet = walletAddress.trim().length > 0;
  const hasDate = dateFrom.trim().length > 0 || dateTo.trim().length > 0;

  // If no filters at all, return empty
  if (!hasKeyword && !hasWallet && !hasDate) {
    return { matches: [], totalSessions: sessions.length, totalMessages: 0 };
  }

  const matches: MessageMatch[] = [];

  for (const session of sessions) {
    // Wallet address filter applies at the session level
    if (hasWallet) {
      const sessionWallet = (session.walletAddress ?? '').toLowerCase();
      if (!sessionWallet.includes(walletAddress.trim().toLowerCase())) continue;
    }

    for (const message of session.messages) {
      if (message.role === 'system') continue;

      // Date range filter
      if (hasDate && !matchesDateRange(message, dateFrom, dateTo)) continue;

      // Keyword filter with highlight positions
      const highlights = hasKeyword ? findHighlights(message.content, keyword.trim()) : [];
      if (hasKeyword && highlights.length === 0) continue;

      matches.push({
        sessionId: session.id,
        sessionTitle: session.title || 'Untitled',
        message,
        highlights,
      });
    }
  }

  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
  return { matches, totalSessions: sessions.length, totalMessages };
}
