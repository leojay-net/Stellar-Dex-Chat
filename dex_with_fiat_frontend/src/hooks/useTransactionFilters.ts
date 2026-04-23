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

/**
 * Keyboard shortcut definitions exposed by the hook.
 */
export const KEYBOARD_SHORTCUTS = {
  clearAll: { key: 'x', modifiers: 'Ctrl+Shift', description: 'Clear all filters' },
  cycleStatus: { key: '1', modifiers: 'Ctrl+Shift', description: 'Cycle status filter' },
  cycleAsset: { key: '2', modifiers: 'Ctrl+Shift', description: 'Cycle asset filter' },
  cycleNetwork: { key: '3', modifiers: 'Ctrl+Shift', description: 'Cycle network filter' },
} as const;

export interface UseTransactionFiltersReturn {
  filterState: FilterState;
  filteredTransactions: TransactionHistoryEntry[];
  filterStats: FilterStats;
  toggleFilter: (category: FilterCategory, value: string) => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
  /** Available keyboard shortcuts for filter management. */
  keyboardShortcuts: typeof KEYBOARD_SHORTCUTS;
}

const DEBOUNCE_DELAY = 150; // ms

/**
 * Hook for managing transaction filters with URL synchronization.
 *
 * Keyboard shortcuts (when focus is not inside an input/textarea):
 * - Ctrl+Shift+X / Cmd+Shift+X  - Clear all filters
 * - Ctrl+Shift+1 / Cmd+Shift+1  - Cycle status filter values
 * - Ctrl+Shift+2 / Cmd+Shift+2  - Cycle asset filter values
 * - Ctrl+Shift+3 / Cmd+Shift+3  - Cycle network filter values
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

  /**
   * Cycle through available values of a filter category using the
   * filter stats. Pressing the shortcut toggles the next available value,
   * or clears the category if all values have been cycled through.
   */
  const cycleFilterCategory = useCallback(
    (category: FilterCategory) => {
      const optionsMap: Record<FilterCategory, { value: string }[]> = {
        status: filterStats.statusOptions,
        asset: filterStats.assetOptions,
        network: filterStats.networkOptions,
      };
      const options = optionsMap[category];
      if (!options || options.length === 0) return;

      const currentValues = filterState[category] as string[];
      const availableValues = options.map((o) => o.value);

      if (currentValues.length === 0) {
        // No filter active -- select first value
        toggleFilter(category, availableValues[0]);
      } else {
        const lastValue = currentValues[currentValues.length - 1];
        const lastIndex = availableValues.indexOf(lastValue);
        const nextIndex = lastIndex + 1;

        if (nextIndex >= availableValues.length) {
          // Cycled through all -- clear category
          const newFilterState: FilterState = {
            ...filterState,
            [category]: [],
          };
          updateUrl(newFilterState);
        } else {
          // Move to next value (replace selection with next single value)
          const newFilterState: FilterState = {
            ...filterState,
            [category]: [availableValues[nextIndex] as never],
          };
          updateUrl(newFilterState);
        }
      }
    },
    [filterState, filterStats, toggleFilter, updateUrl],
  );

  // Register keyboard shortcuts
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isModified = (e.ctrlKey || e.metaKey) && e.shiftKey;
      if (!isModified) return;

      switch (e.key.toLowerCase()) {
        case 'x':
          e.preventDefault();
          clearAllFilters();
          break;
        case '1':
          e.preventDefault();
          cycleFilterCategory('status');
          break;
        case '2':
          e.preventDefault();
          cycleFilterCategory('asset');
          break;
        case '3':
          e.preventDefault();
          cycleFilterCategory('network');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearAllFilters, cycleFilterCategory]);

  return {
    filterState,
    filteredTransactions,
    filterStats,
    toggleFilter,
    clearAllFilters,
    hasActiveFilters,
    keyboardShortcuts: KEYBOARD_SHORTCUTS,
  };
}

