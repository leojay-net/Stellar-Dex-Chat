'use client';

import { useMemo } from 'react';
import { FeatureFlag, getFeatureFlag } from '@/lib/featureFlags';

export function useFeatureFlag(flag: FeatureFlag) {
  return useMemo(() => getFeatureFlag(flag), [flag]);
}
