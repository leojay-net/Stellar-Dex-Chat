import React from 'react';
import Skeleton from './Skeleton';

export default function SkeletonTransactionAmount() {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
