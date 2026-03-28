'use client';

import React from 'react';
import { FilterChip } from './FilterChip';
import type { FilterCategory, FilterOption } from '@/types';

interface FilterChipGroupProps {
  category: FilterCategory;
  label: string;
  options: FilterOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
}

export function FilterChipGroup({
  category,
  label,
  options,
  selectedValues,
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
        {options.map((option) => (
          <FilterChip
            key={`${category}-${option.value}`}
            label={option.label}
            value={option.value}
            count={option.count}
            selected={selectedValues.includes(option.value)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
