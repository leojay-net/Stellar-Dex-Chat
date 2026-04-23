import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useFeatureFlag } from './useFeatureFlag';

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
});
