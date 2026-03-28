'use client';

import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type {
  TransactionHistoryEntry,
  FilterState,
  FilterStats,
  FilterCategory,
} from '@/types';
import { filterTransactions, computeFilterStats } from '@/lib/transactionFilters';
import {
  deserializeFilters,
  mergeFilterParams,
} from '@/lib/filterUrlSerializer';

export interface UseTransactionFiltersReturn {
  filterState: FilterState;
  filteredTransactions: TransactionHistoryEntry[];
  filterStats: FilterStats;
  toggleFilter: (category: FilterCategory, value: string) => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
}

const DEBOUNCE_DELAY = 150; // ms

/**
 * Hook for managing transaction filters with URL synchronization.
 *
 * @param transactions - Array of all transaction history entries
 * @returns Filter state, filtered transactions, and filter management functions
 */
export function useTransactionFilters(
  transactions: TransactionHistoryEntry[],
): UseTransactionFiltersReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Parse filter state from URL (with fallback for SSR)
  const filterState = useMemo(() => {
    try {
      return deserializeFilters(searchParams);
    } catch {
      // Fallback for SSR/SSG
      return { status: [], asset: [], network: [] };
    }
  }, [searchParams]);

  // Compute filtered transactions
  const filteredTransactions = useMemo(() => {
    return filterTransactions(transactions, filterState);
  }, [transactions, filterState]);

  // Compute filter statistics
  const filterStats = useMemo(() => {
    return computeFilterStats(transactions, filterState);
  }, [transactions, filterState]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      filterState.status.length > 0 ||
      filterState.asset.length > 0 ||
      filterState.network.length > 0
    );
  }, [filterState]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Update URL with new filter state (debounced)
  const updateUrl = useCallback(
    (newFilterState: FilterState) => {
      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new timer
      debounceTimerRef.current = setTimeout(() => {
        const newParams = mergeFilterParams(searchParams, newFilterState);
        const queryString = newParams.toString();
        const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
        router.push(newUrl, { scroll: false });
      }, DEBOUNCE_DELAY);
    },
    [router, pathname, searchParams],
  );

  // Toggle a filter value
  const toggleFilter = useCallback(
    (category: FilterCategory, value: string) => {
      const currentValues = filterState[category];
      const newValues = currentValues.includes(value as never)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value as never];

      const newFilterState: FilterState = {
        ...filterState,
        [category]: newValues,
      };

      updateUrl(newFilterState);
    },
    [filterState, updateUrl],
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    const emptyFilterState: FilterState = {
      status: [],
      asset: [],
      network: [],
    };
    updateUrl(emptyFilterState);
  }, [updateUrl]);

  return {
    filterState,
    filteredTransactions,
    filterStats,
    toggleFilter,
    clearAllFilters,
    hasActiveFilters,
  };
}
