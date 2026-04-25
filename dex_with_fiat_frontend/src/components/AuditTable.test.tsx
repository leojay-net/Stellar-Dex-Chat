import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AuditTable from './AuditTable';

describe('AuditTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not apply stale fetch results after a newer request (abort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const signal = init?.signal;
        const isDeposit = u.includes('actionType=deposit');

        return new Promise<Response>((resolve, reject) => {
          const delayMs = isDeposit ? 200 : 0;
          const t = setTimeout(() => {
            if (signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            resolve({
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
            } as Response);
          }, delayMs);

          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }),
    );

    render(<AuditTable />);

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
});
