export const FEATURE_FLAGS = {
  enableConversionReminders:
    process.env.NEXT_PUBLIC_FLAG_CONVERSION_REMINDERS !== 'false',
  enableAdminReconciliation:
    process.env.NEXT_PUBLIC_FLAG_ADMIN_RECONCILIATION !== 'false',
  enableHaptics: process.env.NEXT_PUBLIC_FLAG_ENABLE_HAPTICS !== 'false',
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * Determine whether a feature flag is currently enabled.
 *
 * @param flag - Feature flag key to look up.
 * @returns true when feature is enabled, false otherwise.
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
