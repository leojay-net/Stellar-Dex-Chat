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

/**
 * Tailwind classes for `border-t` dividers in settings panels that include
 * feature-flag-gated blocks (e.g. conversion reminders). Using the same
 * tokens as the main header divider avoids a too-faint light-mode border
 * (`border-gray-100`) that looked inconsistent next to `border-gray-200`.
 */
export function featureFlagSectionDividerBorderClass(
  isDarkMode: boolean,
): string {
  return isDarkMode ? 'border-gray-700' : 'border-gray-200';
}
