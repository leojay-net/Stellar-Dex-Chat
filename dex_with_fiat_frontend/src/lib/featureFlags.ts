export const FEATURE_FLAGS = {
  enableConversionReminders:
    (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_FLAG_CONVERSION_REMINDERS : undefined) !== 'false',
  enableAdminReconciliation:
    (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_FLAG_ADMIN_RECONCILIATION : undefined) !== 'false',
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function getFeatureFlag(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
