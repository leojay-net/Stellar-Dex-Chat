'use client';

import { useState, useEffect, useLayoutEffect } from 'react';
import { FeatureFlag, getFeatureFlag, FeatureFlagNameSchema } from '@/lib/featureFlags';

function trackFeatureFlag(flag: string, enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    const key = `ff_telemetry_${flag}`;
    const prev = sessionStorage.getItem(key);
    const next = String(enabled);
    if (prev === next) return;
    sessionStorage.setItem(key, next);
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'feature_flag_evaluated', { flag_name: flag, flag_enabled: enabled });
    }
  } catch {
    // telemetry must never throw
  }
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Hook to check if a feature flag is enabled.
 * Includes runtime validation using Zod to ensure the flag name is valid.
 * When enabled, automatically scrolls to the specified target element for better UX.
 *
 * @param flag - The name of the feature flag to check.
 * @param scrollTargetId - Optional element ID to scroll to when the flag becomes enabled.
 * @returns boolean indicating if the flag is enabled.
 */
export function useFeatureFlag(flag: FeatureFlag, scrollTargetId?: string) {
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

    const newEnabled = getFeatureFlag(flag);
    setIsEnabled(newEnabled);
    trackFeatureFlag(flag, newEnabled);

    // Auto-scroll behavior: if flag becomes enabled and scrollTargetId is provided, scroll to it
    if (newEnabled && scrollTargetId && typeof window !== 'undefined') {
      const element = document.getElementById(scrollTargetId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [flag, scrollTargetId]);

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
