'use client';

import React from 'react';
import { FilterChipGroup } from './FilterChipGroup';
import type { FilterState, FilterStats, FilterCategory } from '@/types';

interface FilterChipBarProps {
  filterState: FilterState;
  filterStats: FilterStats;
  onFilterChange: (category: FilterCategory, value: string) => void;
  onClearAll: () => void;
}

export function FilterChipBar({
  filterState,
  filterStats,
  onFilterChange,
  onClearAll,
}: FilterChipBarProps) {
  // Hide filter bar when no transactions exist
  if (filterStats.totalCount === 0) {
    return null;
  }

  const hasActiveFilters =
    filterState.status.length > 0 ||
    filterState.asset.length > 0 ||
    filterState.network.length > 0;

  return (
    <div className="flex flex-col gap-4 p-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Filters
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filterStats.filteredCount} of {filterStats.totalCount} transactions
          </span>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            Clear All Filters
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <FilterChipGroup
          category="status"
          label="Status"
          options={filterStats.statusOptions}
          selectedValues={filterState.status}
          onToggle={(value) => onFilterChange('status', value)}
        />

        <FilterChipGroup
          category="asset"
          label="Asset"
          options={filterStats.assetOptions}
          selectedValues={filterState.asset}
          onToggle={(value) => onFilterChange('asset', value)}
        />

        <FilterChipGroup
          category="network"
          label="Network"
          options={filterStats.networkOptions}
          selectedValues={filterState.network}
          onToggle={(value) => onFilterChange('network', value)}
        />
      </div>
    </div>
  );
}
