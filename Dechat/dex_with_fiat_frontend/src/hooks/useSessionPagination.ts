import { useState, useCallback, useMemo, useEffect } from 'react';
import { DEFAULT_PAGE_SIZE } from '@/lib/chatPaginationUtils';

/**
 * Generic list pagination hook following the same virtualisation pattern
 * used by `useChatPagination` but for arbitrary item lists (sessions).
 */
export const useSessionPagination = <T,>(allItems: T[], pageSize: number = DEFAULT_PAGE_SIZE) => {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    if (allItems.length <= pageSize) {
      setVisibleCount(pageSize);
    }
  }, [allItems.length, pageSize]);

  const visibleItems = useMemo(() => {
    if (!allItems || allItems.length === 0) return [] as T[];
    return allItems.slice(-visibleCount);
  }, [allItems, visibleCount]);

  const hasMore = useMemo(() => {
    return allItems.length > visibleCount;
  }, [allItems.length, visibleCount]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);

    // small delay for smoother UX, mirrors useChatPagination
    setTimeout(() => {
      setVisibleCount((prev: number) => {
        const next = prev + pageSize;
        return Math.min(next, allItems.length);
      });
      setIsLoadingMore(false);
    }, 300);
  }, [hasMore, isLoadingMore, allItems.length, pageSize]);

  return {
    visibleItems,
    hasMore,
    isLoadingMore,
    loadMore,
    setVisibleCount,
  } as const;
};
