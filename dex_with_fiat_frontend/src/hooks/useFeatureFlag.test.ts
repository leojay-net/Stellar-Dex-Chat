import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
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
