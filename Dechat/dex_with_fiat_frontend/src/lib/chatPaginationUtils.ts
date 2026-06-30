import { ChatMessage } from '@/types';

/**
 * Default page size for chat messages
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Returns the most recent slice of messages based on page size and current count.
 * For chat, we usually want to start with the most recent messages.
 */
export const getVisibleMessages = (
  allMessages: ChatMessage[],
  targetCount: number = DEFAULT_PAGE_SIZE
): ChatMessage[] => {
  if (!allMessages || allMessages.length === 0) return [];
  
  // Return the last N messages
  return allMessages.slice(-targetCount);
};

/**
 * Checks if there are more messages to load
 */
export const hasMoreMessages = (
  allMessages: ChatMessage[],
  currentVisibleCount: number
): boolean => {
  return allMessages.length > currentVisibleCount;
};

/**
 * Calculates the next count of visible items (generic version)
 */
export const getNextMessageCount = <T,>(
  allItems: T[] | number,
  currentVisibleCount: number,
  pageSize: number = DEFAULT_PAGE_SIZE
): number => {
  const totalCount = typeof allItems === 'number' ? allItems : allItems.length;
  const nextCount = currentVisibleCount + pageSize;
  return Math.min(nextCount, totalCount);
};
