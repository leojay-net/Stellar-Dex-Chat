'use client';

import Skeleton from './Skeleton';

export default function SkeletonTimeline() {
  return (
    <div className="relative" data-testid="skeleton-timeline">
      {/* Vertical connector line */}
      <span
        className="absolute left-[19px] top-5 bottom-5 w-px bg-[var(--color-border)]"
        aria-hidden="true"
      />

      <ol className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <li key={i} className="flex items-start gap-3">
            {/* Status icon badge skeleton */}
            <Skeleton className="relative z-10 flex-shrink-0 w-9 h-9 rounded-full" />

            {/* Label + timestamp skeleton */}
            <div className="flex-1 pb-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
