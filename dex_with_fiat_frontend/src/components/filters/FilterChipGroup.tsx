'use client';

import React from 'react';
import { FilterChip } from './FilterChip';
import type { FilterCategory, FilterOption, FilterChipTone } from '@/types';

interface FilterChipGroupProps {
  category: FilterCategory;
  label: string;
  options: FilterOption[];
  selectedValues: string[];
  getFilterChipTone: (
    category: FilterCategory,
    value: string,
    selected: boolean,
  ) => FilterChipTone;
  onToggle: (value: string) => void;
}

export function FilterChipGroup({
  category,
  label,
  options,
  selectedValues,
  getFilterChipTone,
  onToggle,
}: FilterChipGroupProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {label}
      </h3>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = selectedValues.includes(option.value);
          const tone = getFilterChipTone(category, option.value, selected);

          return (
            <FilterChip
              key={`${category}-${option.value}`}
              label={option.label}
              value={option.value}
              count={option.count}
              selected={selected}
              chipClassName={tone.chipClassName}
              countClassName={tone.countClassName}
              onToggle={onToggle}
            />
          );
        })}
      </div>
    </div>
  );
}
