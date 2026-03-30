import React from 'react';
import Skeleton from './Skeleton';

export default function SkeletonReceipt() {
  return (
    <div className="p-4 space-y-4 border rounded-xl theme-border bg-gray-50/50 dark:bg-gray-800/30">
      {/* Title Row */}
      <Skeleton className="h-6 w-1/3 mb-2" />

      {/* 4 Data Rows (Label/Value pairs) */}
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex justify-between items-center">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>

      {/* Timestamp */}
      <div className="pt-2 flex justify-end">
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}
