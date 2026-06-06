import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import AuditTable from './AuditTable';
import { toastStore } from '@/lib/toastStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTRY_FIXTURE = {
  id: 'e1',
  timestamp: new Date().toISOString(),
  adminAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  actionType: 'deposit',
  actionDescription: 'real-row',
  txHash: 'abc123',
  status: 'success',
};

function makeSuccessResponse(entries = [ENTRY_FIXTURE], total = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ entries, total }),
  };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('AuditTable', () => {
  afterEach(() => {
    cleanup();
    toastStore.clearToasts();
    vi.restoreAllMocks();
  });

  // ── Original tests (must remain passing) ────────────────────────────────

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
    resolveFetch(makeSuccessResponse());

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

  // ── Offline retry queue tests ────────────────────────────────────────────

  it('shows the retry queue banner when going offline and a fetch is queued', async () => {
    // Simulate the browser being offline before render
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves

    render(React.createElement(AuditTable));

    // Banner should appear because the request was queued while offline
    await waitFor(() => {
      const banner = screen.queryByRole('status');
      expect(banner).toBeInTheDocument();
      expect(banner?.textContent).toMatch(/queued/i);
    });

    // Restore
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });

  it('hides the retry queue banner and re-fetches after coming back online', async () => {
    let isOnline = false;
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => isOnline,
    });

    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(React.createElement(AuditTable));

    // Queue banner should be visible while offline
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeInTheDocument();
    });

    // Now come back online – stub fetch to return data this time
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(makeSuccessResponse())),
    );
    isOnline = true;

    await act(async () => {
      fireEvent(window, new Event('online'));
      // Allow microtasks and state updates to flush
      await new Promise((r) => setTimeout(r, 100));
    });

    // After the queue processes the re-fetch, the banner should disappear
    await waitFor(
      () => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('uses withNetworkReadQueue for fetch — queues when offline, delivers when online', async () => {
    let isOnline = false;
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => isOnline,
    });

    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => fetchPromise));

    render(React.createElement(AuditTable));

    // While offline the banner should appear (fetch was deferred)
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeInTheDocument();
    });

    // Go online and resolve the pending fetch
    isOnline = true;

    await act(async () => {
      resolveFetch(makeSuccessResponse());
      fireEvent(window, new Event('online'));
      await new Promise((r) => setTimeout(r, 150));
    });

    // Data should eventually render
    await waitFor(() => {
      expect(screen.getByText('real-row')).toBeInTheDocument();
    }, { timeout: 3000 });

    // And the banner should be gone
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retry queue banner is absent when online and fetch succeeds immediately', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(makeSuccessResponse())),
    );

    render(React.createElement(AuditTable));

    await waitFor(() => {
      expect(screen.getByText('real-row')).toBeInTheDocument();
    });

    // Banner must never appear for a fully-online session
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('banner count label is accessible via aria-label', async () => {
    let isOnline = false;
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => isOnline,
    });

    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(React.createElement(AuditTable));

    await waitFor(() => {
      const span = screen.queryByLabelText(/audit request queued for retry/i);
      expect(span).toBeInTheDocument();
    });

    // Restore
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });
});
