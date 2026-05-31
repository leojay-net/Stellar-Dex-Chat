'use client';

import React from 'react';

export default function SkeletonReceipt() {
  return (
    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 animate-pulse">
      {/* Top row: status icon + kind + badge */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600" />
          <div className="w-20 h-4 rounded bg-gray-300 dark:bg-gray-600" />
        </div>
        <div className="w-14 h-4 rounded-full bg-gray-300 dark:bg-gray-600" />
      </div>

      {/* Amount row */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <div className="w-12 h-3 rounded bg-gray-300 dark:bg-gray-600" />
          <div className="w-24 h-3 rounded bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Fiat row */}
        <div className="flex justify-between">
          <div className="w-8 h-3 rounded bg-gray-300 dark:bg-gray-600" />
          <div className="w-20 h-3 rounded bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Hash row */}
        <div className="flex justify-between items-center gap-2">
          <div className="w-10 h-3 rounded bg-gray-300 dark:bg-gray-600" />
          <div className="w-28 h-3 rounded bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Footer row */}
        <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="w-16 h-2 rounded bg-gray-300 dark:bg-gray-600" />
          <div className="w-24 h-2 rounded bg-gray-300 dark:bg-gray-600" />
        </div>
      </div>
    </div>
  );
}
