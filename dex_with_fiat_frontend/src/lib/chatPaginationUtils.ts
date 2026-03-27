import { ChatMessage } from '@/types';

export const DEFAULT_PAGE_SIZE = 20;

/**
 * Returns the slice of messages that should be displayed for the given page.
 *
 * Messages are ordered oldest-first:  [oldest … newest]
 * Page 1  → last PAGE_SIZE items (most recent)
 * Page 2  → last 2*PAGE_SIZE items, etc.
 *
 * @param messages  Full ordered array of messages
 * @param page      Current page (1-based)
 * @param pageSize  How many messages per page
 */
export function getDisplayedMessages(
  messages: ChatMessage[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): ChatMessage[] {
  const startIdx = Math.max(0, messages.length - page * pageSize);
  return messages.slice(startIdx);
}

/**
 * Returns true if there are older messages beyond the current page.
 */
export function hasMoreMessages(
  totalCount: number,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): boolean {
  return totalCount > page * pageSize;
}
