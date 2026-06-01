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

  it('renders skeleton rows while loading and hides them once data arrives', async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });

    vi.stubGlobal('fetch', vi.fn(() => fetchPromise));

    render(React.createElement(AuditTable));

    // While the fetch is in-flight the table should be in aria-busy state
    const busyTable = await waitFor(() => screen.getByRole('table', { name: /loading audit entries/i }));
    expect(busyTable).toHaveAttribute('aria-busy', 'true');

    // Skeleton cells are present (5 rows × 6 cells = 30 skeleton divs)
    const skeletonCells = busyTable.querySelectorAll('td');
    expect(skeletonCells.length).toBe(30);

    // Resolve the fetch with real data
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            id: 'e1',
            timestamp: new Date().toISOString(),
            adminAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
            actionType: 'deposit',
            actionDescription: 'real-row',
            txHash: 'abc123',
            status: 'success',
          },
        ],
        total: 1,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('real-row')).toBeInTheDocument();
    });

    // The skeleton table should no longer be in the DOM
    expect(screen.queryByRole('table', { name: /loading audit entries/i })).not.toBeInTheDocument();
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
