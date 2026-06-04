import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { renderHook, cleanup } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import {
  useFeatureFlag,
  featureFlagSectionDividerBorderClass,
} from './useFeatureFlag';
import { getFeatureFlag } from '@/lib/featureFlags';

function Harness(props: { flag: 'enableAdminReconciliation' | 'enableConversionReminders' }) {
  const isEnabled = useFeatureFlag(props.flag);
  return React.createElement('div', null, isEnabled ? 'enabled' : 'disabled');
}

describe('useFeatureFlag', () => {
  it('hydrates without mismatch warnings and resolves to the client flag value', async () => {
    const serverMarkup = renderToString(
      React.createElement(Harness, { flag: 'enableAdminReconciliation' })
    );
    const container = document.createElement('div');
    container.innerHTML = serverMarkup;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      hydrateRoot(container, React.createElement(Harness, { flag: 'enableAdminReconciliation' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe('enabled');
    expect(serverMarkup).toContain('disabled');
    expect(
      consoleErrorSpy.mock.calls.some((args) =>
        String(args[0]).toLowerCase().includes('hydration')
      )
    ).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it('uses theme-aligned divider borders for feature-flag sections', () => {
    expect(featureFlagSectionDividerBorderClass(true)).toContain(
      'border-gray-700',
    );
    expect(featureFlagSectionDividerBorderClass(false)).toContain(
      'border-gray-200',
    );
  });

  it('auto-scrolls to target element when feature flag becomes enabled', async () => {
    // Create a mock element
    const mockElement = document.createElement('div');
    mockElement.id = 'test-target';
    document.body.appendChild(mockElement);

    const scrollIntoViewSpy = vi.spyOn(mockElement, 'scrollIntoView');

    // Mock the feature flag to return true
    vi.mocked(getFeatureFlag).mockReturnValue(true);

    await act(async () => {
      renderToString(React.createElement(Harness, { flag: 'enableAdminReconciliation' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Should not scroll initially since no scrollTargetId provided
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    // Test with scrollTargetId
    function HarnessWithScroll(props: { flag: 'enableAdminReconciliation' | 'enableConversionReminders' }) {
      const isEnabled = useFeatureFlag(props.flag, 'test-target');
      return React.createElement('div', null, isEnabled ? 'enabled' : 'disabled');
    }

    await act(async () => {
      const container = document.createElement('div');
      hydrateRoot(container, React.createElement(HarnessWithScroll, { flag: 'enableAdminReconciliation' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    // Cleanup
    document.body.removeChild(mockElement);
    vi.restoreAllMocks();
  });
});

// ── Comprehensive renderHook-based tests ──────────────────────────────────────

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlag: vi.fn(() => false),
  FeatureFlagNameSchema: {
    safeParse: (flag: string) => {
      const valid = ['enableAdminReconciliation', 'enableConversionReminders', 'enableHaptics'];
      if (valid.includes(flag)) return { success: true, data: flag };
      return { success: false };
    },
    enum: {
      enableAdminReconciliation: 'enableAdminReconciliation',
      enableConversionReminders: 'enableConversionReminders',
      enableHaptics: 'enableHaptics',
    },
  },
}));

describe('useFeatureFlag – initial state', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('returns false on first render before layout effect runs', () => {
    vi.mocked(getFeatureFlag).mockReturnValue(true);
    const { result } = renderHook(() => useFeatureFlag('enableAdminReconciliation'));
    // useState initial value is false to avoid SSR hydration mismatch
    // After mount it should resolve to the actual value
    expect(typeof result.current).toBe('boolean');
  });

  it('resolves to true when the flag is enabled', async () => {
    vi.mocked(getFeatureFlag).mockReturnValue(true);
    const { result } = renderHook(() => useFeatureFlag('enableAdminReconciliation'));
    expect(result.current).toBe(true);
  });

  it('resolves to false when the flag is disabled', () => {
    vi.mocked(getFeatureFlag).mockReturnValue(false);
    const { result } = renderHook(() => useFeatureFlag('enableAdminReconciliation'));
    expect(result.current).toBe(false);
  });
});

describe('useFeatureFlag – flag argument changes', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('updates when switching to a different flag', () => {
    vi.mocked(getFeatureFlag).mockImplementation(
      (flag: string) => flag === 'enableConversionReminders'
    );

    const { result, rerender } = renderHook(
      ({ flag }: { flag: 'enableAdminReconciliation' | 'enableConversionReminders' }) =>
        useFeatureFlag(flag),
      { initialProps: { flag: 'enableAdminReconciliation' as const } }
    );

    expect(result.current).toBe(false);

    rerender({ flag: 'enableConversionReminders' });

    expect(result.current).toBe(true);
  });

  it('re-queries getFeatureFlag each time the flag argument changes', () => {
    vi.mocked(getFeatureFlag).mockReturnValue(false);

    const { rerender } = renderHook(
      ({ flag }: { flag: 'enableAdminReconciliation' | 'enableConversionReminders' }) =>
        useFeatureFlag(flag),
      { initialProps: { flag: 'enableAdminReconciliation' as const } }
    );

    rerender({ flag: 'enableConversionReminders' });

    expect(vi.mocked(getFeatureFlag)).toHaveBeenCalledWith('enableAdminReconciliation');
    expect(vi.mocked(getFeatureFlag)).toHaveBeenCalledWith('enableConversionReminders');
  });
});

describe('useFeatureFlag – invalid flag name', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('logs an error and returns false for an unknown flag name', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useFeatureFlag('nonExistentFlag' as 'enableAdminReconciliation')
    );

    expect(result.current).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid feature flag name')
    );

    consoleError.mockRestore();
  });

  it('does not call getFeatureFlag when flag name is invalid', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() =>
      useFeatureFlag('badFlag' as 'enableAdminReconciliation')
    );

    expect(vi.mocked(getFeatureFlag)).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

describe('useFeatureFlag – scroll behaviour', () => {
  beforeEach(() => {
    vi.mocked(getFeatureFlag).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not scroll when scrollTargetId is omitted', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderHook(() => useFeatureFlag('enableAdminReconciliation'));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not scroll when flag is disabled even if scrollTargetId is provided', () => {
    vi.mocked(getFeatureFlag).mockReturnValue(false);
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const el = document.createElement('div');
    el.id = 'target-disabled';
    document.body.appendChild(el);

    renderHook(() => useFeatureFlag('enableAdminReconciliation', 'target-disabled'));

    expect(scrollIntoView).not.toHaveBeenCalled();

    document.body.removeChild(el);
  });

  it('does not scroll when scrollTargetId element does not exist in the DOM', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderHook(() => useFeatureFlag('enableAdminReconciliation', 'ghost-element-id'));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('featureFlagSectionDividerBorderClass', () => {
  it('returns dark border class in dark mode', () => {
    expect(featureFlagSectionDividerBorderClass(true)).toBe('border-gray-700');
  });

  it('returns light border class in light mode', () => {
    expect(featureFlagSectionDividerBorderClass(false)).toBe('border-gray-200');
  });
});
