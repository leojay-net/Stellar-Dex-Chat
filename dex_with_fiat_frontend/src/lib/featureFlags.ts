import { z } from 'zod';

/**
 * Zod schema for feature flag configuration.
 * This ensures all flags are booleans and provides a central place to define them.
 */
export const FeatureFlagsConfigSchema = z.object({
  enableConversionReminders: z.boolean().default(true),
  enableAdminReconciliation: z.boolean().default(true),
  enableHaptics: z.boolean().default(true),
});

export type FeatureFlagsConfig = z.infer<typeof FeatureFlagsConfigSchema>;

/**
 * Raw configuration mapped from environment variables.
 * We use a helper to convert 'false' string to boolean false.
 */
const rawConfig = {
  enableConversionReminders:
    process.env.NEXT_PUBLIC_FLAG_CONVERSION_REMINDERS !== 'false',
  enableAdminReconciliation:
    process.env.NEXT_PUBLIC_FLAG_ADMIN_RECONCILIATION !== 'false',
  enableHaptics: process.env.NEXT_PUBLIC_FLAG_ENABLE_HAPTICS !== 'false',
};

/**
 * Validated feature flags.
 */
export const FEATURE_FLAGS = FeatureFlagsConfigSchema.parse(rawConfig);

/**
 * Zod schema for a single feature flag name.
 * Useful for runtime validation in hooks and components.
 */
export const FeatureFlagNameSchema = z.enum(
  Object.keys(FEATURE_FLAGS) as [string, ...string[]],
);

export type FeatureFlag = z.infer<typeof FeatureFlagNameSchema>;

/**
 * Determine whether a feature flag is currently enabled.
 *
 * @param flag - Feature flag key to look up.
 * @returns true when feature is enabled, false otherwise.
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  // We use safeParse here to handle potential invalid inputs at runtime
  const result = FeatureFlagNameSchema.safeParse(flag);
  if (!result.success) {
    console.error(`[FeatureFlags] Invalid feature flag requested: ${flag}`);
    return false;
  }
  return FEATURE_FLAGS[result.data as keyof typeof FEATURE_FLAGS];
}
