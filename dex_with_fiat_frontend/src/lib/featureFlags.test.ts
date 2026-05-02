import { describe, it, expect, vi } from 'vitest';
import { getFeatureFlag, FeatureFlagNameSchema } from './featureFlags';

describe('FeatureFlags', () => {
  it('should return the correct value for a valid feature flag', () => {
    // These are the default values from our schema
    expect(getFeatureFlag('enableConversionReminders')).toBe(true);
    expect(getFeatureFlag('enableAdminReconciliation')).toBe(true);
    expect(getFeatureFlag('enableHaptics')).toBe(true);
  });

  it('should return false and log an error for an invalid feature flag', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // @ts-expect-error - Testing invalid input
    const result = getFeatureFlag('nonExistentFlag');
    
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid feature flag requested: nonExistentFlag')
    );
    
    consoleSpy.mockRestore();
  });

  it('should have a name schema with all defined flags', () => {
    const keys = Object.keys(FeatureFlagNameSchema.enum);
    expect(keys).toContain('enableConversionReminders');
    expect(keys).toContain('enableAdminReconciliation');
    expect(keys).toContain('enableHaptics');
    expect(keys.length).toBe(3);
  });
});
