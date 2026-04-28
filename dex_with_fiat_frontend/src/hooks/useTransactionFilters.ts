'use client';

import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type {
  TransactionHistoryEntry,
  FilterState,
  FilterStats,
  FilterCategory,
  FilterChipTone,
  TransactionStatus,
} from '@/types';
import { filterTransactions, computeFilterStats } from '@/lib/transactionFilters';
import {
  deserializeFilters,
  mergeFilterParams,
} from '@/lib/filterUrlSerializer';

function areFilterStatesEqual(a: FilterState, b: FilterState): boolean {
  return (
    a.status.length === b.status.length &&
    a.asset.length === b.asset.length &&
    a.network.length === b.network.length &&
    a.status.every((value, index) => value === b.status[index]) &&
    a.asset.every((value, index) => value === b.asset[index]) &&
    a.network.every((value, index) => value === b.network[index])
  );
}

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
  getFilterChipTone: (
    category: FilterCategory,
    value: string,
    selected: boolean,
  ) => FilterChipTone;
  /** Available keyboard shortcuts for filter management. */
  keyboardShortcuts: typeof KEYBOARD_SHORTCUTS;
}

const DEBOUNCE_DELAY = 150; // ms

interface FilterToneState {
  chipClassName: string;
  countClassName: string;
}

interface FilterTonePair {
  selected: FilterToneState;
  unselected: FilterToneState;
}

const FILTER_TONE_PALETTES = {
  blue: {
    selected: {
      chipClassName:
        'border-transparent bg-blue-700 text-white hover:bg-blue-800 focus:ring-blue-600 dark:bg-blue-300 dark:text-blue-950 dark:hover:bg-blue-200 dark:focus:ring-blue-300',
      countClassName:
        'bg-blue-900 text-blue-50 dark:bg-blue-950 dark:text-blue-100',
    },
    unselected: {
      chipClassName:
        'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 focus:ring-blue-400 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60',
      countClassName:
        'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    },
  },
  emerald: {
    selected: {
      chipClassName:
        'border-transparent bg-emerald-700 text-white hover:bg-emerald-800 focus:ring-emerald-600 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200 dark:focus:ring-emerald-300',
      countClassName:
        'bg-emerald-900 text-emerald-50 dark:bg-emerald-950 dark:text-emerald-100',
    },
    unselected: {
      chipClassName:
        'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus:ring-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/60',
      countClassName:
        'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    },
  },
  amber: {
    selected: {
      chipClassName:
        'border-transparent bg-amber-700 text-white hover:bg-amber-800 focus:ring-amber-600 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200 dark:focus:ring-amber-300',
      countClassName:
        'bg-amber-900 text-amber-50 dark:bg-amber-950 dark:text-amber-100',
    },
    unselected: {
      chipClassName:
        'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 focus:ring-amber-400 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60',
      countClassName:
        'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    },
  },
  red: {
    selected: {
      chipClassName:
        'border-transparent bg-red-700 text-white hover:bg-red-800 focus:ring-red-600 dark:bg-red-300 dark:text-red-950 dark:hover:bg-red-200 dark:focus:ring-red-300',
      countClassName:
        'bg-red-900 text-red-50 dark:bg-red-950 dark:text-red-100',
    },
    unselected: {
      chipClassName:
        'border-red-200 bg-red-50 text-red-800 hover:bg-red-100 focus:ring-red-400 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60',
      countClassName:
        'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    },
  },
  slate: {
    selected: {
      chipClassName:
        'border-transparent bg-slate-700 text-white hover:bg-slate-800 focus:ring-slate-600 dark:bg-slate-300 dark:text-slate-950 dark:hover:bg-slate-200 dark:focus:ring-slate-300',
      countClassName:
        'bg-slate-900 text-slate-50 dark:bg-slate-950 dark:text-slate-100',
    },
    unselected: {
      chipClassName:
        'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
      countClassName:
        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    },
  },
  indigo: {
    selected: {
      chipClassName:
        'border-transparent bg-indigo-700 text-white hover:bg-indigo-800 focus:ring-indigo-600 dark:bg-indigo-300 dark:text-indigo-950 dark:hover:bg-indigo-200 dark:focus:ring-indigo-300',
      countClassName:
        'bg-indigo-900 text-indigo-50 dark:bg-indigo-950 dark:text-indigo-100',
    },
    unselected: {
      chipClassName:
        'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 focus:ring-indigo-400 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/60',
      countClassName:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    },
  },
  violet: {
    selected: {
      chipClassName:
        'border-transparent bg-violet-700 text-white hover:bg-violet-800 focus:ring-violet-600 dark:bg-violet-300 dark:text-violet-950 dark:hover:bg-violet-200 dark:focus:ring-violet-300',
      countClassName:
        'bg-violet-900 text-violet-50 dark:bg-violet-950 dark:text-violet-100',
    },
    unselected: {
      chipClassName:
        'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 focus:ring-violet-400 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60',
      countClassName:
        'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
    },
  },
  cyan: {
    selected: {
      chipClassName:
        'border-transparent bg-cyan-700 text-white hover:bg-cyan-800 focus:ring-cyan-600 dark:bg-cyan-300 dark:text-cyan-950 dark:hover:bg-cyan-200 dark:focus:ring-cyan-300',
      countClassName:
        'bg-cyan-900 text-cyan-50 dark:bg-cyan-950 dark:text-cyan-100',
    },
    unselected: {
      chipClassName:
        'border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 focus:ring-cyan-400 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200 dark:hover:bg-cyan-950/60',
      countClassName:
        'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    },
  },
} as const satisfies Record<string, FilterTonePair>;

const STATUS_TONE_KEYS: Record<TransactionStatus, keyof typeof FILTER_TONE_PALETTES> = {
  pending: 'amber',
  completed: 'emerald',
  warning: 'blue',
  failed: 'red',
  cancelled: 'slate',
};

const ASSET_TONE_SEQUENCE: Array<keyof typeof FILTER_TONE_PALETTES> = [
  'blue',
  'indigo',
  'violet',
  'cyan',
  'emerald',
];

const NETWORK_TONE_SEQUENCE: Array<keyof typeof FILTER_TONE_PALETTES> = [
  'amber',
  'blue',
  'slate',
  'cyan',
];

function hashFilterValue(value: string): number {
  return Array.from(value).reduce(
    (hash, character) => hash + character.charCodeAt(0),
    0,
  );
}

function getToneKeyForCategory(
  category: FilterCategory,
  value: string,
): keyof typeof FILTER_TONE_PALETTES {
  if (category === 'status' && value in STATUS_TONE_KEYS) {
    return STATUS_TONE_KEYS[value as TransactionStatus];
  }

  const sequence =
    category === 'asset' ? ASSET_TONE_SEQUENCE : NETWORK_TONE_SEQUENCE;

  return sequence[hashFilterValue(value) % sequence.length];
}

export function getAccessibleFilterChipTone(
  category: FilterCategory,
  value: string,
  selected: boolean,
): FilterChipTone {
  const toneKey = getToneKeyForCategory(category, value);
  const palette = FILTER_TONE_PALETTES[toneKey];
  const toneState = selected ? palette.selected : palette.unselected;

  return {
    chipClassName: toneState.chipClassName,
    countClassName: toneState.countClassName,
  };
}

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
  const pendingFilterStateRef = useRef<FilterState | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const [optimisticFilterState, setOptimisticFilterState] = useState<FilterState | null>(
    null,
  );

  // Parse filter state from URL (with fallback for SSR)
  const urlFilterState = useMemo(() => {
    try {
      return deserializeFilters(searchParams);
    } catch {
      // Fallback for SSR/SSG
      return { status: [], asset: [], network: [] };
    }
  }, [searchParams]);

  const filterState = optimisticFilterState ?? urlFilterState;

  useEffect(() => {
    if (
      pendingFilterStateRef.current &&
      areFilterStatesEqual(pendingFilterStateRef.current, urlFilterState)
    ) {
      pendingFilterStateRef.current = null;
      setOptimisticFilterState(null);
    }
  }, [urlFilterState, optimisticFilterState]);

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
      const now = Date.now();
      if (now - lastUpdateTimeRef.current < 50) {
        return;
      }
      lastUpdateTimeRef.current = now;

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      pendingFilterStateRef.current = newFilterState;
      setOptimisticFilterState(newFilterState);

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
      const currentFilterState = pendingFilterStateRef.current ?? filterState;
      const currentValues = currentFilterState[category];
      const newValues = currentValues.includes(value as never)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value as never];

      const newFilterState: FilterState = {
        ...currentFilterState,
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

  const getFilterChipTone = useCallback(
    (category: FilterCategory, value: string, selected: boolean) =>
      getAccessibleFilterChipTone(category, value, selected),
    [],
  );

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

      const currentFilterState = pendingFilterStateRef.current ?? filterState;
      const currentValues = currentFilterState[category] as string[];
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
            ...currentFilterState,
            [category]: [],
          };
          updateUrl(newFilterState);
        } else {
          // Move to next value (replace selection with next single value)
          const newFilterState: FilterState = {
            ...currentFilterState,
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
    getFilterChipTone,
    keyboardShortcuts: KEYBOARD_SHORTCUTS,
  };
}
