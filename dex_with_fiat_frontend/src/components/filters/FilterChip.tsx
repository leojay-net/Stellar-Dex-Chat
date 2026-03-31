'use client';

import React from 'react';

interface FilterChipProps {
  label: string;
  value: string;
  count: number;
  selected: boolean;
  onToggle: (value: string) => void;
  disabled?: boolean;
}

export function FilterChip({
  label,
  value,
  count,
  selected,
  onToggle,
  disabled = false,
}: FilterChipProps) {
  const handleClick = () => {
    if (!disabled) {
      onToggle(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onToggle(value);
    }
  };

  return (
    <button
      type="button"
      role="button"
      aria-pressed={selected}
      aria-label={`Filter by ${label}, ${count} transactions`}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`
        inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium
        transition-all duration-200 ease-in-out
        focus:outline-none focus:ring-2 focus:ring-offset-2
        ${
          selected
            ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span>{label}</span>
      <span
        className={`
          inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-semibold
          ${
            selected
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }
        `}
      >
        {count}
      </span>
    </button>
  );
}
