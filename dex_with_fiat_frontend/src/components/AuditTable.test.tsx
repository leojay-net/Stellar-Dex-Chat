import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import AuditTable from './AuditTable';
import { toastStore } from '@/lib/toastStore';

describe('AuditTable', () => {
  afterEach(() => {
    cleanup();
    toastStore.clearToasts();
    vi.restoreAllMocks();
  });

  it('does not apply stale fetch results after a newer request (abort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const signal = init?.signal;
        const isDeposit = u.includes('actionType=deposit');

        if (isDeposit) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            entries: isDeposit
              ? [
                  {
                    id: 'stale',
                    timestamp: new Date().toISOString(),
                    adminAddress:
                      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                    actionType: 'deposit',
                    actionDescription: 'stale-row',
                    txHash: 'abc',
                    status: 'success',
                  },
                ]
              : [
                  {
                    id: 'fresh',
                    timestamp: new Date().toISOString(),
                    adminAddress:
                      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                    actionType: 'payout',
                    actionDescription: 'fresh-row',
                    txHash: 'def',
                    status: 'success',
                  },
                ],
            total: 1,
          }),
        } as Response;
      }),
    );

    render(React.createElement(AuditTable));

    await waitFor(() => {
      expect(screen.getByText('fresh-row')).toBeInTheDocument();
    });

    const actionSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(actionSelect, { target: { value: 'deposit' } });
    fireEvent.change(actionSelect, { target: { value: '' } });

    await waitFor(
      () => {
        expect(screen.getByText('fresh-row')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    expect(screen.queryByText('stale-row')).not.toBeInTheDocument();
  });

  it('shows a warning toast when the browser goes offline while open', async () => {
    const addToastSpy = vi.spyOn(toastStore, 'addToast');
    render(React.createElement(AuditTable));

    fireEvent(window, new Event('offline'));

    await waitFor(() => {
      expect(addToastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringMatching(/offline/i),
        }),
      );
    });
  });

  it('shows a success toast when coming back online after offline', async () => {
    const addToastSpy = vi.spyOn(toastStore, 'addToast');
    render(React.createElement(AuditTable));

    fireEvent(window, new Event('offline'));
    await waitFor(() => expect(addToastSpy).toHaveBeenCalled());

    addToastSpy.mockClear();
    fireEvent(window, new Event('online'));

    await waitFor(() => {
      expect(addToastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          message: expect.stringMatching(/online|refresh/i),
        }),
      );
    });
  });
});
