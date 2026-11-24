import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';
import { useFeatureFlag, useClipboardCopy } from '../useFeatureFlag';
import * as featureFlags from '@/lib/featureFlags';

describe('useFeatureFlag', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the requested feature flag on the first render', () => {
    vi.spyOn(featureFlags, 'getFeatureFlag').mockImplementation(
      (flag) => flag === 'enableAdminReconciliation',
    );

    const { result } = renderHook(() =>
      useFeatureFlag('enableAdminReconciliation'),
    );

    expect(result.current).toBe(true);
    expect(featureFlags.getFeatureFlag).toHaveBeenCalledWith(
      'enableAdminReconciliation',
    );
  });

  it('updates immediately when the requested flag changes', () => {
    vi.spyOn(featureFlags, 'getFeatureFlag').mockImplementation(
      (flag) => flag === 'enableConversionReminders',
    );

    const { result, rerender } = renderHook<
      boolean,
      { flag: 'enableAdminReconciliation' | 'enableConversionReminders' }
    >(
      ({
        flag,
      }: {
        flag: 'enableAdminReconciliation' | 'enableConversionReminders';
      }) => useFeatureFlag(flag),
      {
        initialProps: {
          flag: 'enableAdminReconciliation' as
            | 'enableAdminReconciliation'
            | 'enableConversionReminders',
        },
      },
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
    const storageListeners = addSpy.mock.calls.filter(
      ([type]) => type === 'storage',
    );
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
    vi.spyOn(featureFlags, 'getFeatureFlag').mockImplementation(
      () => flagEnabled,
    );

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

describe('useClipboardCopy', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard',
  );
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies text to clipboard and sets isCopied to true', async () => {
    const { result } = renderHook(() => useClipboardCopy());

    expect(result.current.isCopied).toBe(false);

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    expect(writeText).toHaveBeenCalledWith('test text');
    expect(result.current.isCopied).toBe(true);
  });

  it('resets isCopied after the specified duration', async () => {
    const { result } = renderHook(() => useClipboardCopy(1000));

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    expect(result.current.isCopied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.isCopied).toBe(false);
  });

  it('uses default duration of 2000ms when not specified', async () => {
    const { result } = renderHook(() => useClipboardCopy());

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    expect(result.current.isCopied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1999);
    });

    expect(result.current.isCopied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.isCopied).toBe(false);
  });

  it('handles clipboard errors gracefully', async () => {
    writeText.mockRejectedValue(new Error('Clipboard error'));

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { result } = renderHook(() => useClipboardCopy());

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    expect(result.current.isCopied).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to copy to clipboard:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('does nothing when window is undefined (SSR)', async () => {
    const { result } = renderHook(() => useClipboardCopy());

    vi.stubGlobal('window', undefined);
    try {
      await result.current.copyToClipboard('test text');
      expect(writeText).not.toHaveBeenCalled();
      expect(result.current.isCopied).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
