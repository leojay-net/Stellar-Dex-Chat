import { useState, useCallback, useMemo, useEffect } from 'react';
import { ChatMessage } from '@/types';
import {
  DEFAULT_PAGE_SIZE,
  getVisibleMessages,
  hasMoreMessages,
  getNextMessageCount,
} from '@/lib/chatPaginationUtils';

/**
 * Hook to manage chat message pagination
 * @param allMessages The full list of messages from the current session
 * @param pageSize Number of messages per page
 */
export const useChatPagination = (
  allMessages: ChatMessage[],
  pageSize: number = DEFAULT_PAGE_SIZE
) => {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Reset visible count when session changes (if we had a way to detect it)
  // Actually, useChat will manage messages per session, so we just react to allMessages length decreasing
  // (which happens on new chat or session switch)
  useEffect(() => {
    if (allMessages.length <= pageSize) {
      setVisibleCount(pageSize);
    }
  }, [allMessages.length, pageSize]);

  const visibleMessages = useMemo(() => {
    return getVisibleMessages(allMessages, visibleCount);
  }, [allMessages, visibleCount]);

  const hasMore = useMemo(() => {
    return hasMoreMessages(allMessages, visibleCount);
  }, [allMessages, visibleCount]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    
    // Simulate a small delay for better UX (optional, but requested "loading guards")
    setTimeout(() => {
      setVisibleCount((prev: number) => getNextMessageCount(allMessages, prev, pageSize));
      setIsLoadingMore(false);
    }, 400);
  }, [hasMore, isLoadingMore, allMessages, pageSize]);

  return {
    visibleMessages,
    hasMore,
    isLoadingMore,
    loadMore,
  };
};
