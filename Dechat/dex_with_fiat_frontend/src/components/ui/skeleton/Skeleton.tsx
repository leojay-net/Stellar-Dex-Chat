import React from 'react';
import { cn } from '@/lib/utils';

type SkeletonProps = {
  className?: string;
};

export default function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse motion-reduce:animate-none rounded-md bg-gray-700/40',
        className,
      )}
    />
  );
}
