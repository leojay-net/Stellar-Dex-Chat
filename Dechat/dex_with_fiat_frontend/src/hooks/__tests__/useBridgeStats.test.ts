import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useBridgeStats from '../useBridgeStats';
import * as stellarContract from '@/lib/stellarContract';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/stellarContract', () => ({
  getContractBalance: vi.fn(),
  getBridgeLimit: vi.fn(),
  getTotalDeposited: vi.fn(),
  clearCache: vi.fn(),
}));

const mockGetContractBalance = vi.mocked(stellarContract.getContractBalance);
const mockGetBridgeLimit = vi.mocked(stellarContract.getBridgeLimit);
const mockGetTotalDeposited = vi.mocked(stellarContract.getTotalDeposited);
const mockClearCache = vi.mocked(stellarContract.clearCache);

// Helpers
function resolveContracts(b: bigint, l: bigint, t: bigint) {
  mockGetContractBalance.mockResolvedValue(b);
  mockGetBridgeLimit.mockResolvedValue(l);
  mockGetTotalDeposited.mockResolvedValue(t);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBridgeStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with null values and loading false before first fetch resolves', () => {
    // Keep promises pending so we observe the initial state
    mockGetContractBalance.mockReturnValue(new Promise(() => {}));
    mockGetBridgeLimit.mockReturnValue(new Promise(() => {}));
    mockGetTotalDeposited.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useBridgeStats());

    expect(result.current.balance).toBeNull();
    expect(result.current.limit).toBeNull();
    expect(result.current.totalDeposited).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('populates stats after successful fetch', async () => {
    resolveContracts(500n, 1000n, 300n);

    const { result } = renderHook(() => useBridgeStats());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balance).toBe(500n);
    expect(result.current.limit).toBe(1000n);
    expect(result.current.totalDeposited).toBe(300n);
    expect(result.current.error).toBeNull();
  });

  it('increments fetchCount on each successful fetch', async () => {
    resolveContracts(1n, 2n, 3n);

    const { result } = renderHook(() => useBridgeStats());

    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    // Trigger a second fetch
    resolveContracts(10n, 20n, 30n);
    await act(() => result.current.refetchStats());

    expect(result.current.fetchCount).toBe(2);
  });

  it('sets lastFetchedAt to a Date after successful fetch', async () => {
    resolveContracts(1n, 2n, 3n);

    const { result } = renderHook(() => useBridgeStats());

    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());
    expect(result.current.lastFetchedAt).toBeInstanceOf(Date);
  });

  it('sets error and leaves stats unchanged when fetch fails', async () => {
    mockGetContractBalance.mockRejectedValue(new Error('network error'));
    mockGetBridgeLimit.mockRejectedValue(new Error('network error'));
    mockGetTotalDeposited.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useBridgeStats());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/network error/i);
    expect(result.current.balance).toBeNull();
  });

  it('refresh clears the cache before re-fetching', async () => {
    resolveContracts(1n, 2n, 3n);
    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    resolveContracts(99n, 98n, 97n);
    await act(() => result.current.refresh());

    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(result.current.balance).toBe(99n);
  });

  it('dispatches bridge_stats_telemetry CustomEvent on successful fetch', async () => {
    resolveContracts(5n, 10n, 3n);

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('bridge_stats_telemetry', handler);

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    window.removeEventListener('bridge_stats_telemetry', handler);

    const names = events.map((e) => e.detail.event);
    expect(names).toContain('bridge_stats_mounted');
    expect(names).toContain('bridge_stats_fetch_success');
  });

  it('dispatches bridge_stats_fetch_error telemetry event on failure', async () => {
    mockGetContractBalance.mockRejectedValue(new Error('rpc down'));
    mockGetBridgeLimit.mockRejectedValue(new Error('rpc down'));
    mockGetTotalDeposited.mockRejectedValue(new Error('rpc down'));

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('bridge_stats_telemetry', handler);

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.error).toBeTruthy());

    window.removeEventListener('bridge_stats_telemetry', handler);

    const names = events.map((e) => e.detail.event);
    expect(names).toContain('bridge_stats_fetch_error');
  });

  it('dispatches bridge_stats_manual_refresh on refresh()', async () => {
    resolveContracts(1n, 2n, 3n);
    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('bridge_stats_telemetry', handler);

    await act(() => result.current.refresh());

    window.removeEventListener('bridge_stats_telemetry', handler);

    expect(events.map((e) => e.detail.event)).toContain(
      'bridge_stats_manual_refresh',
    );
  });
});
