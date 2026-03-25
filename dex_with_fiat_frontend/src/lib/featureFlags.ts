/**
 * Typed Feature Flag Registry
 * Provides type-safe feature flag management with environment-based configuration
 */

// Define all available feature flags with their types and descriptions
export interface FeatureFlagDefinition {
  key: string;
  type: 'boolean' | 'string' | 'number';
  defaultValue: boolean | string | number;
  description: string;
  category: 'ui' | 'api' | 'analytics' | 'security' | 'experimental';
}

// Registry of all feature flags in the application
export const FEATURE_FLAGS: Record<string, FeatureFlagDefinition> = {
  // UI Features
  'ui-dark-mode': {
    key: 'ui-dark-mode',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable dark mode theme',
    category: 'ui',
  },
  'ui-new-dashboard': {
    key: 'ui-new-dashboard',
    type: 'boolean',
    defaultValue: true,
    description: 'Show new dashboard design',
    category: 'ui',
  },
  'ui-advanced-analytics': {
    key: 'ui-advanced-analytics',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable advanced analytics charts',
    category: 'ui',
  },

  // API Features
  'api-rate-limiting': {
    key: 'api-rate-limiting',
    type: 'boolean',
    defaultValue: true,
    description: 'Enable API rate limiting',
    category: 'api',
  },
  'api-caching': {
    key: 'api-caching',
    type: 'boolean',
    defaultValue: true,
    description: 'Enable response caching',
    category: 'api',
  },
  'api-webhooks': {
    key: 'api-webhooks',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable webhook support',
    category: 'api',
  },

  // Analytics Features
  'analytics-advanced-tracking': {
    key: 'analytics-advanced-tracking',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable detailed analytics tracking',
    category: 'analytics',
  },
  'analytics-real-time': {
    key: 'analytics-real-time',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable real-time analytics updates',
    category: 'analytics',
  },

  // Security Features
  'security-2fa': {
    key: 'security-2fa',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable two-factor authentication',
    category: 'security',
  },
  'security-audit-logging': {
    key: 'security-audit-logging',
    type: 'boolean',
    defaultValue: true,
    description: 'Enable security audit logging',
    category: 'security',
  },

  // Experimental Features
  'experimental-ai-assistant': {
    key: 'experimental-ai-assistant',
    type: 'boolean',
    defaultValue: true,
    description: 'Enable AI assistant features',
    category: 'experimental',
  },
  'experimental-beta-transfers': {
    key: 'experimental-beta-transfers',
    type: 'boolean',
    defaultValue: false,
    description: 'Enable beta transfer features',
    category: 'experimental',
  },
} as const;

// Type inference for feature flag keys
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

// Type inference for feature flag values
export type FeatureFlagValue<T extends FeatureFlagKey> = 
  typeof FEATURE_FLAGS[T]['defaultValue'];

// Environment-based feature flag configuration
interface FeatureFlagConfig {
  [key: string]: boolean | string | number;
}

/**
 * Get feature flag value from environment variables or default
 */
function getFlagValue<T extends FeatureFlagKey>(
  flag: T
): FeatureFlagValue<T> {
  const definition = FEATURE_FLAGS[flag];
  const envKey = `NEXT_PUBLIC_FEATURE_${flag.toUpperCase().replace('-', '_')}`;
  
  // Check environment variable first
  const envValue = process.env[envKey];
  
  if (envValue !== undefined) {
    // Parse environment value based on flag type
    switch (definition.type) {
      case 'boolean':
        return envValue === 'true' || envValue === '1' as FeatureFlagValue<T>;
      case 'number':
        const numValue = Number(envValue);
        return (isNaN(numValue) ? definition.defaultValue : numValue) as FeatureFlagValue<T>;
      case 'string':
        return envValue as FeatureFlagValue<T>;
    }
  }
  
  return definition.defaultValue as FeatureFlagValue<T>;
}

/**
 * Feature flag registry class for managing flags
 */
export class FeatureFlagRegistry {
  private static instance: FeatureFlagRegistry;
  private cache: Map<FeatureFlagKey, FeatureFlagValue<any>> = new Map();

  private constructor() {}

  static getInstance(): FeatureFlagRegistry {
    if (!FeatureFlagRegistry.instance) {
      FeatureFlagRegistry.instance = new FeatureFlagRegistry();
    }
    return FeatureFlagRegistry.instance;
  }

  /**
   * Get the value of a feature flag
   */
  isEnabled<T extends FeatureFlagKey>(flag: T): FeatureFlagValue<T> {
    if (this.cache.has(flag)) {
      return this.cache.get(flag) as FeatureFlagValue<T>;
    }

    const value = getFlagValue(flag);
    this.cache.set(flag, value);
    return value;
  }

  /**
   * Check if a boolean feature flag is enabled
   */
  isBooleanEnabled(flag: FeatureFlagKey): boolean {
    const value = this.isEnabled(flag);
    return Boolean(value);
  }

  /**
   * Get all feature flags and their current values
   */
  getAllFlags(): Record<FeatureFlagKey, FeatureFlagValue<any>> {
    const flags = {} as Record<FeatureFlagKey, FeatureFlagValue<any>>;
    
    for (const flagKey of Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]) {
      flags[flagKey] = this.isEnabled(flagKey);
    }
    
    return flags;
  }

  /**
   * Get flags by category
   */
  getFlagsByCategory(category: FeatureFlagDefinition['category']): Record<FeatureFlagKey, FeatureFlagValue<any>> {
    const flags = {} as Record<FeatureFlagKey, FeatureFlagValue<any>>;
    
    for (const [flagKey, definition] of Object.entries(FEATURE_FLAGS)) {
      if (definition.category === category) {
        flags[flagKey as FeatureFlagKey] = this.isEnabled(flagKey as FeatureFlagKey);
      }
    }
    
    return flags;
  }

  /**
   * Clear the cache (useful for testing or runtime updates)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get feature flag definition
   */
  getDefinition(flag: FeatureFlagKey): FeatureFlagDefinition {
    return FEATURE_FLAGS[flag];
  }

  /**
   * Get all feature flag definitions
   */
  getAllDefinitions(): Record<FeatureFlagKey, FeatureFlagDefinition> {
    return FEATURE_FLAGS;
  }
}

// Export singleton instance
export const featureFlags = FeatureFlagRegistry.getInstance();

/**
 * Convenience functions for common operations
 */
export function isFeatureEnabled<T extends FeatureFlagKey>(flag: T): FeatureFlagValue<T> {
  return featureFlags.isEnabled(flag);
}

export function isBooleanFeatureEnabled(flag: FeatureFlagKey): boolean {
  return featureFlags.isBooleanEnabled(flag);
}

/**
 * Feature flag validation utilities
 */
export function validateFeatureFlag(flag: string): flag is FeatureFlagKey {
  return flag in FEATURE_FLAGS;
}

export function getFeatureFlagCategories(): FeatureFlagDefinition['category'][] {
  return ['ui', 'api', 'analytics', 'security', 'experimental'];
}

export function getFeatureFlagsByCategory(category: FeatureFlagDefinition['category']): FeatureFlagKey[] {
  return Object.entries(FEATURE_FLAGS)
    .filter(([, definition]) => definition.category === category)
    .map(([key]) => key as FeatureFlagKey);
}
