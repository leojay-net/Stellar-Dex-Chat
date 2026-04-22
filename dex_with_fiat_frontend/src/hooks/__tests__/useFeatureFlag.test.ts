import { renderHook } from '@testing-library/react';
import { useFeatureFlag } from '../useFeatureFlag';
import * as featureFlags from '@/lib/featureFlags';

describe('useFeatureFlag', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the requested feature flag on the first render', () => {
    jest
      .spyOn(featureFlags, 'getFeatureFlag')
      .mockImplementation((flag) => flag === 'enableAdminReconciliation');

    const { result } = renderHook(() =>
      useFeatureFlag('enableAdminReconciliation')
    );

    expect(result.current).toBe(true);
    expect(featureFlags.getFeatureFlag).toHaveBeenCalledWith(
      'enableAdminReconciliation'
    );
  });

  it('updates immediately when the requested flag changes', () => {
    jest
      .spyOn(featureFlags, 'getFeatureFlag')
      .mockImplementation((flag) => flag === 'enableConversionReminders');

    const { result, rerender } = renderHook(
      ({ flag }) => useFeatureFlag(flag),
      {
        initialProps: {
          flag: 'enableAdminReconciliation' as const,
        },
      }
    );

    expect(result.current).toBe(false);

    rerender({ flag: 'enableConversionReminders' });

    expect(result.current).toBe(true);
  });
});
