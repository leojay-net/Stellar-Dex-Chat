import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  pageSize: number = DEFAULT_PAGE_SIZE,
) => {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Root cause (#1224): `loadMore` (below) closes over `allMessages` and
  // `pageSize` from the render in which it was created, then reads them
  // again 400ms later inside a `setTimeout` callback. If new messages
  // arrive, or the user switches sessions, while that timer is pending, the
  // callback still computes the next visible count against the *stale*
  // message list captured at call time - not the list that's actually on
  // screen when the timer fires. That can under- or over-count how many
  // messages should become visible after a session switch.
  //
  // Fixed by mirroring `allMessages`/`pageSize` into refs that are always
  // kept current, and reading from the refs inside the timeout callback
  // instead of the closed-over values - the same pattern already used for
  // `addToastRef` in `usePaystackWebhookStatus` and `messagesRef` in
  // `useChat`.
  const allMessagesRef = useRef(allMessages);
  const pageSizeRef = useRef(pageSize);

  useEffect(() => {
    allMessagesRef.current = allMessages;
  }, [allMessages]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  // Reset visible count when session changes (if we had a way to detect it)
  // Actually, useChat will manage messages per session, so we just react to allMessages length decreasing
  // (which happens on new chat or session switch)
  useEffect(() => {
    if (allMessages.length <= pageSize) {
      setVisibleCount(pageSize);
    }
  }, [allMessages.length, pageSize]);

  // Clear pending load-more timer on unmount to prevent state updates on an unmounted component.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const visibleMessages = useMemo(() => {
    return getVisibleMessages(allMessages, visibleCount);
  }, [allMessages, visibleCount]);

  const hasMore = useMemo(() => {
    return hasMoreMessages(allMessages, visibleCount);
  }, [allMessages, visibleCount]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setVisibleCount((prev: number) =>
        getNextMessageCount(allMessagesRef.current, prev, pageSizeRef.current),
      );
      setIsLoadingMore(false);
    }, 400);
  }, [hasMore, isLoadingMore]);

  return {
    visibleMessages,
    hasMore,
    isLoadingMore,
    loadMore,
  };
};
