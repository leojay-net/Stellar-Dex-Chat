import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { useFeatureFlag } from '../useFeatureFlag';
import * as featureFlags from '@/lib/featureFlags';

describe('useFeatureFlag', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the requested feature flag on the first render', () => {
    vi
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
    vi
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

  // ── memory-leak regression (#1220) ─────────────────────────────────────────

  it('regression: removes storage listener on unmount so it does not leak', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    vi.spyOn(featureFlags, 'getFeatureFlag').mockReturnValue(false);

    const { unmount } = renderHook(() => useFeatureFlag('enableHaptics'));

    // A storage listener must have been registered.
    const storageListeners = addSpy.mock.calls.filter(([type]) => type === 'storage');
    expect(storageListeners.length).toBeGreaterThan(0);

    const registeredHandler = storageListeners[0][1];

    unmount();

    // On unmount the same handler must be removed — no leak.
    const removedStorageListeners = removeSpy.mock.calls.filter(
      ([type, fn]) => type === 'storage' && fn === registeredHandler,
    );
    expect(removedStorageListeners.length).toBeGreaterThan(0);
  });

  it('re-evaluates the flag when a storage event fires', () => {
    let flagEnabled = false;
    vi.spyOn(featureFlags, 'getFeatureFlag').mockImplementation(() => flagEnabled);

    const { result } = renderHook(() => useFeatureFlag('enableHaptics'));
    expect(result.current).toBe(false);

    // Simulate a storage change that flips the flag.
    flagEnabled = true;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage'));
    });

    expect(result.current).toBe(true);
  });
});
