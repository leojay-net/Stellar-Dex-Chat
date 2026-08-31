import { ChatMessage } from '@/types';

/**
 * Default pagination page size for message batch loading.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Returns the most recent slice of chat messages based on requested target count.
 *
 * ### Boundary Safety
 * Uses negative slice notation (`-targetCount`) to cleanly return the trailing `N` messages
 * without risk of index out-of-bounds or array length overflow.
 *
 * @param allMessages - Full message array.
 * @param targetCount - Desired number of recent messages to display (defaults to {@link DEFAULT_PAGE_SIZE}).
 * @returns Array slice containing at most `targetCount` recent messages.
 */
export const getVisibleMessages = (
  allMessages: ChatMessage[],
  targetCount: number = DEFAULT_PAGE_SIZE,
): ChatMessage[] => {
  if (!allMessages || allMessages.length === 0) return [];

  // Return the last N messages
  return allMessages.slice(-targetCount);
};

/**
 * Checks whether additional older messages remain to be paginated.
 *
 * @param allMessages - Full message array.
 * @param currentVisibleCount - Number of messages currently rendered.
 * @returns `true` if unrendered messages exist, `false` otherwise.
 */
export const hasMoreMessages = (
  allMessages: ChatMessage[],
  currentVisibleCount: number,
): boolean => {
  return allMessages.length > currentVisibleCount;
};

/**
 * Calculates the next visible item count for pagination, strictly bounded by total available items.
 *
 * ### Boundary Clamping
 * Evaluates `Math.min(currentVisibleCount + pageSize, totalCount)` to guarantee the visible
 * count never overflows the total available collection size.
 *
 * @template T - Type of items in collection.
 * @param allItems - Total item array or numeric item count.
 * @param currentVisibleCount - Number of items currently visible.
 * @param pageSize - Incremental page size to append (defaults to {@link DEFAULT_PAGE_SIZE}).
 * @returns The next clamped count of items to render.
 */
export const getNextMessageCount = <T>(
  allItems: T[] | number,
  currentVisibleCount: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): number => {
  const totalCount = typeof allItems === 'number' ? allItems : allItems.length;
  const nextCount = currentVisibleCount + pageSize;
  return Math.min(nextCount, totalCount);
};

