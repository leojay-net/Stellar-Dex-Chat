'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChatMessage } from '@/types';
import {
  getDisplayedMessages,
  hasMoreMessages,
  DEFAULT_PAGE_SIZE,
} from '@/lib/chatPaginationUtils';

interface UseChatPaginationProps {
  messages: ChatMessage[];
  sessionId: string | null;
  pageSize?: number;
}

export function useChatPagination({
  messages,
  sessionId,
  pageSize = DEFAULT_PAGE_SIZE,
}: UseChatPaginationProps) {
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Reset page whenever the user switches to a different chat session
  useEffect(() => {
    setPage(1);
    setIsLoadingMore(false);
  }, [sessionId]);

  // Also reset if the history is fully cleared
  useEffect(() => {
    if (messages.length < pageSize && page > 1) {
      setPage(1);
    }
  }, [messages.length, pageSize, page]);

  const displayedMessages = useMemo(
    () => getDisplayedMessages(messages, page, pageSize),
    [messages, page, pageSize],
  );

  const hasMore = hasMoreMessages(messages.length, page, pageSize);

  /**
   * Load the next (older) page of messages.
   * A 300 ms artificial delay prevents the UI from flickering if messages
   * are already in memory, and acts as a loading guard so the callback
   * cannot be invoked concurrently.
   */
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    setPage((p: number) => p + 1);
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore]);

  return {
    displayedMessages,
    hasMore,
    isLoadingMore,
    loadMore,
    page,
  };
}
