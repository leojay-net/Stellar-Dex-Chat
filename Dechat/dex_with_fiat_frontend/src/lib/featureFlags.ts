import { z } from 'zod';

/**
 * Zod schema for feature flag configuration.
 *
 * Defines the shape of the runtime feature flag object.  Every flag is a
 * boolean that defaults to `true` so that new deployments automatically
 * opt in unless explicitly disabled via environment variable.
 *
 * Adding a new flag here — together with a corresponding
 * `NEXT_PUBLIC_FLAG_*` env-var lookup in {@link rawConfig} — is the only
 * step needed to introduce a new toggle.
 *
 * @example
 * ```ts
 * FeatureFlagsConfigSchema.parse({ enableConversionReminders: false })
 * // → { enableConversionReminders: false, enableAdminReconciliation: true, enableHaptics: true }
 * ```
 */
export const FeatureFlagsConfigSchema = z.object({
  enableConversionReminders: z.boolean().default(true),
  enableAdminReconciliation: z.boolean().default(true),
  enableHaptics: z.boolean().default(true),
});

/**
 * Inferred type of a validated feature-flag configuration object.
 *
 * Each key matches a `NEXT_PUBLIC_FLAG_*` environment variable and maps
 * to a boolean value.  Use this type for function signatures that accept
 * or return flag configs.
 *
 * @example
 * ```ts
 * const cfg: FeatureFlagsConfig = { enableConversionReminders: false, enableAdminReconciliation: true, enableHaptics: true };
 * ```
 *
 * @see {@link FeatureFlagsConfigSchema} — the schema that produces this type.
 * @see {@link FEATURE_FLAGS} — the runtime singleton of this type.
 */
export type FeatureFlagsConfig = z.infer<typeof FeatureFlagsConfigSchema>;

/**
 * Raw configuration mapped from environment variables.
 *
 * Each entry reads a `NEXT_PUBLIC_FLAG_*` variable and treats any value
 * *except* the literal string `"false"` as `true`.  This means setting
 * `NEXT_PUBLIC_FLAG_X=false` disables the flag while omitting the
 * variable, setting it to `"true"`, or setting it to any other value
 * enables it.
 *
 * This object is validated against {@link FeatureFlagsConfigSchema} to
 * produce the exported {@link FEATURE_FLAGS} singleton.
 */
const rawConfig = {
  enableConversionReminders:
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_FLAG_CONVERSION_REMINDERS
      : undefined) !== 'false',
  enableAdminReconciliation:
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_FLAG_ADMIN_RECONCILIATION
      : undefined) !== 'false',
  enableHaptics:
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_FLAG_ENABLE_HAPTICS
      : undefined) !== 'false',
};

/**
 * Validated, ready-to-use feature flags singleton.
 *
 * Parsed once at module load time from {@link rawConfig} using
 * {@link FeatureFlagsConfigSchema}.  Access individual flags directly:
 *
 * ```ts
 * if (FEATURE_FLAGS.enableConversionReminders) { ... }
 * ```
 *
 * For dynamic lookup by string key see {@link getFeatureFlag}.
 */
export const FEATURE_FLAGS = FeatureFlagsConfigSchema.parse(rawConfig);

/**
 * Zod schema for a single feature flag name.
 *
 * Useful for runtime validation in hooks and components that receive a
 * flag name as a string (e.g. from URL params or user input) and need
 * to confirm it matches a real flag before looking it up.
 *
 * @example
 * ```ts
 * FeatureFlagNameSchema.parse("enableHaptics")       // → "enableHaptics"
 * FeatureFlagNameSchema.safeParse("nonexistent")      // → { success: false }
 * ```
 *
 * @see {@link getFeatureFlag} — consumer of this schema.
 */
export const FeatureFlagNameSchema = z.enum(
  Object.keys(FEATURE_FLAGS) as [string, ...string[]],
);

/** String literal union of all recognised feature flag names. */
export type FeatureFlag = z.infer<typeof FeatureFlagNameSchema>;

/**
 * Determine whether a feature flag is currently enabled.
 *
 * Designed for dynamic lookups where the flag name arrives as a string
 * (from URL params, API responses, or user configuration).  Invalid or
 * unknown flag names are silently treated as disabled and logged to the
 * console.
 *
 * @param flag - The feature flag key to look up.  Must match one of the
 *               keys in {@link FEATURE_FLAGS}.
 * @returns `true` when the feature is enabled, `false` when disabled or
 *          when `flag` is not a recognised flag name.
 *
 * @example
 * ```ts
 * getFeatureFlag("enableConversionReminders") // → true
 * getFeatureFlag("nonexistent")               // → false  (console.error logged)
 * ```
 *
 * @see {@link FEATURE_FLAGS} — direct-access alternative when the key is
 *      known at compile time.
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
