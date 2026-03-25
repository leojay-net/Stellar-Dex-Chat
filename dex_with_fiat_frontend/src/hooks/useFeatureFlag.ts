'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  featureFlags, 
  FeatureFlagKey, 
  FeatureFlagValue, 
  FeatureFlagDefinition,
  isFeatureEnabled,
  isBooleanFeatureEnabled
} from '@/lib/featureFlags';

/**
 * Hook for reading a single feature flag
 */
export function useFeatureFlag<T extends FeatureFlagKey>(
  flag: T
): FeatureFlagValue<T> {
  const [value, setValue] = useState<FeatureFlagValue<T>>(() => 
    featureFlags.isEnabled(flag)
  );

  useEffect(() => {
    // Update value if it changes (useful for runtime updates)
    const currentValue = featureFlags.isEnabled(flag);
    if (currentValue !== value) {
      setValue(currentValue);
    }
  }, [flag, value]);

  return value;
}

/**
 * Hook for reading boolean feature flags with convenience methods
 */
export function useBooleanFeatureFlag(flag: FeatureFlagKey): {
  enabled: boolean;
  value: boolean;
  isLoading: boolean;
  definition: FeatureFlagDefinition;
  refresh: () => void;
} {
  const [enabled, setEnabled] = useState(() => 
    featureFlags.isBooleanEnabled(flag)
  );
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(() => {
    setIsLoading(true);
    // Clear cache to force refresh
    featureFlags.clearCache();
    const newValue = featureFlags.isBooleanEnabled(flag);
    setEnabled(newValue);
    setIsLoading(false);
  }, [flag]);

  useEffect(() => {
    const currentValue = featureFlags.isBooleanEnabled(flag);
    if (currentValue !== enabled) {
      setEnabled(currentValue);
    }
  }, [flag, enabled]);

  return {
    enabled,
    value: enabled,
    isLoading,
    refresh,
    definition: featureFlags.getDefinition(flag),
  };
}

/**
 * Hook for reading multiple feature flags
 */
export function useFeatureFlags<T extends FeatureFlagKey[]>(
  flags: T
): Record<T[number], FeatureFlagValue<T[number]>> {
  const [values, setValues] = useState(() => {
    const initialValues = {} as Record<T[number], FeatureFlagValue<T[number]>>;
    flags.forEach(flag => {
      initialValues[flag] = featureFlags.isEnabled(flag);
    });
    return initialValues;
  });

  useEffect(() => {
    const newValues = {} as Record<T[number], FeatureFlagValue<T[number]>>;
    let hasChanges = false;

    flags.forEach(flag => {
      const currentValue = featureFlags.isEnabled(flag);
      newValues[flag] = currentValue;
      if (currentValue !== values[flag]) {
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setValues(newValues);
    }
  }, [flags, values]);

  return values;
}

/**
 * Hook for getting all feature flags in a specific category
 */
export function useFeatureFlagsByCategory(
  category: FeatureFlagDefinition['category']
): Record<FeatureFlagKey, FeatureFlagValue<any>> {
  const [values, setValues] = useState(() => 
    featureFlags.getFlagsByCategory(category)
  );

  useEffect(() => {
    const newValues = featureFlags.getFlagsByCategory(category);
    setValues(newValues);
  }, [category]);

  return values;
}

/**
 * Hook for feature flag management and debugging
 */
export function useFeatureFlagDebug() {
  const [allFlags, setAllFlags] = useState(() => 
    featureFlags.getAllFlags()
  );
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(() => {
    setIsLoading(true);
    featureFlags.clearCache();
    const newFlags = featureFlags.getAllFlags();
    setAllFlags(newFlags);
    setIsLoading(false);
  }, []);

  const getFlag = useCallback(<T extends FeatureFlagKey>(flag: T) => {
    return featureFlags.isEnabled(flag);
  }, []);

  const isFlagEnabled = useCallback((flag: FeatureFlagKey) => {
    return featureFlags.isBooleanEnabled(flag);
  }, []);

  const getDefinition = useCallback((flag: FeatureFlagKey) => {
    return featureFlags.getDefinition(flag);
  }, []);

  useEffect(() => {
    const newFlags = featureFlags.getAllFlags();
    setAllFlags(newFlags);
  }, []);

  return {
    allFlags,
    isLoading,
    refresh,
    getFlag,
    isFlagEnabled,
    getDefinition,
    definitions: featureFlags.getAllDefinitions(),
  };
}

/**
 * Higher-order component for conditional rendering based on feature flags
 */
export function withFeatureFlag<T extends object>(
  Component: React.ComponentType<T>,
  flag: FeatureFlagKey,
  fallback?: React.ComponentType | React.ReactElement | null
) {
  return function FeatureFlagWrapper(props: T) {
    const enabled = useBooleanFeatureFlag(flag);

    if (!enabled.enabled) {
      if (fallback === null) {
        return null;
      }
      if (React.isValidElement(fallback)) {
        return fallback;
      }
      if (typeof fallback === 'function') {
        const FallbackComponent = fallback as React.ComponentType;
        return <FallbackComponent />;
      }
      return <div>Feature not available</div>;
    }

    return <Component {...props} />;
  };
}

/**
 * Component for conditional rendering based on feature flags
 */
export function FeatureFlagged({
  flag,
  children,
  fallback = null,
}: {
  flag: FeatureFlagKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { enabled } = useBooleanFeatureFlag(flag);

  if (!enabled) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Component for showing content only when feature flag is disabled
 */
export function FeatureFlagDisabled({
  flag,
  children,
  fallback = null,
}: {
  flag: FeatureFlagKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { enabled } = useBooleanFeatureFlag(flag);

  if (enabled) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Hook for A/B testing with feature flags
 */
export function useABTest<T extends FeatureFlagKey>(
  flag: T,
  variants: Record<string, React.ComponentType | React.ReactNode>
) {
  const value = useFeatureFlag(flag);
  const Variant = variants[String(value)] || variants.default;

  return {
    value,
    Variant,
    isVariant: (variant: string) => String(value) === variant,
  };
}
