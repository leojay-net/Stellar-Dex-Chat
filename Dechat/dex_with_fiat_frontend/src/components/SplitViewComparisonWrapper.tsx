'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import type { ChatSession } from '@/types';
import { useSplitView } from '@/hooks/useSplitView';

const SplitViewComparison = dynamic(() => import('./SplitViewComparison'), {
  ssr: false,
});

interface SplitViewComparisonWrapperProps {
  splitView: ReturnType<typeof useSplitView>;
  sessions: ChatSession[];
}

export default function SplitViewComparisonWrapper(
  props: SplitViewComparisonWrapperProps,
) {
  return (
    <Suspense fallback={null}>
      <SplitViewComparison {...props} />
    </Suspense>
  );
}
