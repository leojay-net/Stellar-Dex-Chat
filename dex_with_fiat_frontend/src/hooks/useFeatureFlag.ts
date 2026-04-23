'use client';

import { useState, useEffect, useLayoutEffect } from 'react';
import { FeatureFlag, getFeatureFlag, FeatureFlagNameSchema } from '@/lib/featureFlags';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Hook to check if a feature flag is enabled.
 * Includes runtime validation using Zod to ensure the flag name is valid.
 * 
 * @param flag - The name of the feature flag to check.
 * @returns boolean indicating if the flag is enabled.
 */
export function useFeatureFlag(flag: FeatureFlag) {
  // Initialize to false for safe hydration, then update to actual value.
  const [isEnabled, setIsEnabled] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const validation = FeatureFlagNameSchema.safeParse(flag);

    if (!validation.success) {
      console.error(
        `[useFeatureFlag] Invalid feature flag name: "${flag}". ` +
        `Expected one of: ${Object.keys(FeatureFlagNameSchema.enum).join(', ')}`
      );
      setIsEnabled(false);
      return;
    }

    setIsEnabled(getFeatureFlag(flag));
  }, [flag]);

  return isEnabled;
}
