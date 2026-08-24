import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import useBridgeStats from './useBridgeStats';

vi.mock('@/lib/stellarContract', () => ({
  getContractBalance: vi.fn(),
  getBridgeLimit: vi.fn(),
  getTotalDeposited: vi.fn(),
  clearCache: vi.fn(),
}));

import {
  getContractBalance,
  getBridgeLimit,
  getTotalDeposited,
} from '@/lib/stellarContract';

const mockGetContractBalance = vi.mocked(getContractBalance);
const mockGetBridgeLimit = vi.mocked(getBridgeLimit);
const mockGetTotalDeposited = vi.mocked(getTotalDeposited);

describe('useBridgeStats', () => {
  beforeEach(() => {
    mockGetContractBalance.mockResolvedValue(100n);
    mockGetBridgeLimit.mockResolvedValue(1000n);
    mockGetTotalDeposited.mockResolvedValue(500n);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fetches stats on mount and sets state', async () => {
    const { result } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.balance).toBe(100n);
    expect(result.current.limit).toBe(1000n);
    expect(result.current.totalDeposited).toBe(500n);
    expect(result.current.fetchCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('does not update state after unmount', async () => {
    vi.useFakeTimers();
    let resolveBalance!: (v: bigint) => void;
    mockGetContractBalance.mockReturnValue(
      new Promise<bigint>((resolve) => { resolveBalance = resolve; }),
    );
    mockGetBridgeLimit.mockResolvedValue(1000n);
    mockGetTotalDeposited.mockResolvedValue(500n);

    const { result, unmount } = renderHook(() => useBridgeStats());

    unmount();

    // Resolve after unmount — should not throw or update state
    expect(() => { resolveBalance(200n); }).not.toThrow();

    await vi.runAllTimersAsync();

    // State should remain at initial values since component was unmounted
    expect(result.current.balance).toBeNull();
  });

  it('discards stale concurrent fetch result when a newer fetch supersedes it', async () => {
    let resolveFirst!: (v: bigint) => void;
    let resolveSecond!: (v: bigint) => void;

    mockGetContractBalance
      .mockReturnValueOnce(new Promise<bigint>((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise<bigint>((r) => { resolveSecond = r; }));
    mockGetBridgeLimit.mockResolvedValue(1000n);
    mockGetTotalDeposited.mockResolvedValue(500n);

    const { result } = renderHook(() => useBridgeStats());

    // Trigger a second fetch (manual refresh) before the first completes
    act(() => {
      void result.current.refetchStats();
    });

    // Resolve the second (newer) fetch first
    resolveSecond(999n);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Now resolve the first (stale) fetch — its result should be discarded
    resolveFirst(111n);
    await new Promise((r) => setTimeout(r, 0));

    // The newer fetch result (999n) should be preserved
    expect(result.current.balance).toBe(999n);
  });

  it('sets error state when fetch fails', async () => {
    mockGetContractBalance.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.balance).toBeNull();
  });

  it('dispatches bridge_stats_telemetry events', async () => {
    const events: CustomEvent[] = [];
    window.addEventListener('bridge_stats_telemetry', (e) => {
      events.push(e as CustomEvent);
    });

    const { unmount } = renderHook(() => useBridgeStats());

    await waitFor(() => {
      expect(events.some((e) => e.detail?.event === 'bridge_stats_mounted')).toBe(true);
    });

    await waitFor(() => {
      expect(events.some((e) => e.detail?.event === 'bridge_stats_fetch_success')).toBe(true);
    });

    unmount();
    window.removeEventListener('bridge_stats_telemetry', (e) => {
      events.push(e as CustomEvent);
    });
  });
});
