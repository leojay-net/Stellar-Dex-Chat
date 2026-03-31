'use client';

import { useState, useEffect } from 'react';
import { FeatureFlag, getFeatureFlag } from '@/lib/featureFlags';

export function useFeatureFlag(flag: FeatureFlag) {
  // Initialize to false for safe hydration, then update to actual value
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    setIsEnabled(getFeatureFlag(flag));
  }, [flag]);

  return isEnabled;
}
