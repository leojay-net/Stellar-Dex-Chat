import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBridgeStats, {
  BRIDGE_STATS_TELEMETRY_EVENT,
  BRIDGE_STATS_TELEMETRY_VERSION,
  type BridgeStatsTelemetryDetail,
} from '../useBridgeStats';
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

function resolveContracts(b: bigint, l: bigint, t: bigint) {
  mockGetContractBalance.mockResolvedValue(b);
  mockGetBridgeLimit.mockResolvedValue(l);
  mockGetTotalDeposited.mockResolvedValue(t);
}

/** Collect every telemetry record dispatched while the returned handle lives. */
function recordTelemetry() {
  const records: BridgeStatsTelemetryDetail[] = [];
  const handler = (e: Event) => {
    records.push((e as CustomEvent<BridgeStatsTelemetryDetail>).detail);
  };
  window.addEventListener(BRIDGE_STATS_TELEMETRY_EVENT, handler);
  return {
    records,
    names: () => records.map((r) => r.event),
    find: (name: string) => records.find((r) => r.event === name),
    filter: (name: string) => records.filter((r) => r.event === name),
    stop: () => window.removeEventListener(BRIDGE_STATS_TELEMETRY_EVENT, handler),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBridgeStats telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps every record with the schema version and a timestamp', async () => {
    resolveContracts(5n, 10n, 3n);
    const telemetry = recordTelemetry();

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));
    telemetry.stop();

    expect(telemetry.records.length).toBeGreaterThan(0);
    for (const record of telemetry.records) {
      expect(record.version).toBe(BRIDGE_STATS_TELEMETRY_VERSION);
      expect(typeof record.timestamp).toBe('number');
      expect(record.timestamp).toBeGreaterThan(0);
    }
  });

  it('emits mount, fetch_start and fetch_success for the initial load', async () => {
    resolveContracts(5n, 10n, 3n);
    const telemetry = recordTelemetry();

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));
    telemetry.stop();

    expect(telemetry.names()).toContain('bridge_stats_mounted');
    expect(telemetry.names()).toContain('bridge_stats_fetch_start');
    expect(telemetry.names()).toContain('bridge_stats_fetch_success');
  });

  it('tags the initial fetch with the mount trigger', async () => {
    resolveContracts(1n, 2n, 3n);
    const telemetry = recordTelemetry();

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));
    telemetry.stop();

    expect(telemetry.find('bridge_stats_fetch_start')?.trigger).toBe('mount');
    expect(telemetry.find('bridge_stats_fetch_success')?.trigger).toBe('mount');
  });

  it('serializes contract amounts as decimal strings so the payload stays JSON-safe', async () => {
    resolveContracts(12345678901234567890n, 1000n, 42n);
    const telemetry = recordTelemetry();

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));
    telemetry.stop();

    const success = telemetry.find('bridge_stats_fetch_success');
    expect(success?.balance).toBe('12345678901234567890');
    expect(success?.limit).toBe('1000');
    expect(success?.totalDeposited).toBe('42');
    expect(() => JSON.stringify(success)).not.toThrow();
  });

  it('reports the running fetch count and a numeric duration on success', async () => {
    resolveContracts(1n, 2n, 3n);
    const telemetry = recordTelemetry();

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    await act(() => result.current.refetchStats());
    telemetry.stop();

    const successes = telemetry.filter('bridge_stats_fetch_success');
    expect(successes.map((r) => r.fetchCount)).toEqual([1, 2]);
    for (const record of successes) {
      expect(typeof record.durationMs).toBe('number');
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('tags a programmatic refetch distinctly from the mount fetch', async () => {
    resolveContracts(1n, 2n, 3n);

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    const telemetry = recordTelemetry();
    await act(() => result.current.refetchStats());
    telemetry.stop();

    expect(telemetry.find('bridge_stats_fetch_start')?.trigger).toBe('programmatic');
    expect(telemetry.find('bridge_stats_fetch_success')?.trigger).toBe('programmatic');
  });

  it('emits manual_refresh and tags the resulting fetch as manual', async () => {
    resolveContracts(1n, 2n, 3n);

    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    const telemetry = recordTelemetry();
    await act(() => result.current.refresh());
    telemetry.stop();

    expect(telemetry.names()).toContain('bridge_stats_manual_refresh');
    expect(telemetry.find('bridge_stats_fetch_start')?.trigger).toBe('manual');
    expect(telemetry.find('bridge_stats_fetch_success')?.trigger).toBe('manual');
  });

  it('emits fetch_error with the message and no success record when the read fails', async () => {
    mockGetContractBalance.mockRejectedValue(new Error('rpc down'));
    mockGetBridgeLimit.mockRejectedValue(new Error('rpc down'));
    mockGetTotalDeposited.mockRejectedValue(new Error('rpc down'));

    const telemetry = recordTelemetry();
    const { result } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    telemetry.stop();

    const failure = telemetry.find('bridge_stats_fetch_error');
    expect(failure?.error).toBe('rpc down');
    expect(failure?.trigger).toBe('mount');
    expect(typeof failure?.durationMs).toBe('number');
    expect(telemetry.names()).not.toContain('bridge_stats_fetch_success');
  });

  it('emits fetch_discarded with reason "superseded" when a newer fetch wins the race', async () => {
    let resolveFirst!: (v: bigint) => void;
    let resolveSecond!: (v: bigint) => void;

    mockGetContractBalance
      .mockReturnValueOnce(new Promise<bigint>((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise<bigint>((r) => { resolveSecond = r; }));
    mockGetBridgeLimit.mockResolvedValue(1000n);
    mockGetTotalDeposited.mockResolvedValue(500n);

    const telemetry = recordTelemetry();
    const { result } = renderHook(() => useBridgeStats());

    act(() => {
      void result.current.refetchStats();
    });

    resolveSecond(999n);
    await waitFor(() => expect(result.current.balance).toBe(999n));

    resolveFirst(111n);
    await waitFor(() =>
      expect(telemetry.names()).toContain('bridge_stats_fetch_discarded'),
    );
    telemetry.stop();

    const discarded = telemetry.find('bridge_stats_fetch_discarded');
    expect(discarded?.reason).toBe('superseded');
    expect(discarded?.trigger).toBe('mount');
    // The superseded result must not be reported as a success.
    expect(telemetry.filter('bridge_stats_fetch_success')).toHaveLength(1);
    expect(result.current.balance).toBe(999n);
  });

  it('emits unmounted with the lifetime fetch count', async () => {
    resolveContracts(1n, 2n, 3n);

    const telemetry = recordTelemetry();
    const { result, unmount } = renderHook(() => useBridgeStats());
    await waitFor(() => expect(result.current.fetchCount).toBe(1));

    unmount();
    telemetry.stop();

    const unmounted = telemetry.find('bridge_stats_unmounted');
    expect(unmounted).toBeDefined();
    expect(unmounted?.fetchCount).toBe(1);
    expect(typeof unmounted?.lifetimeMs).toBe('number');
    expect(unmounted?.lifetimeMs).toBeGreaterThanOrEqual(0);
  });

  it('tags the 30-second background poll with the poll trigger', async () => {
    vi.useFakeTimers();
    resolveContracts(1n, 2n, 3n);

    const { result } = renderHook(() => useBridgeStats());
    await vi.waitFor(() => expect(result.current.fetchCount).toBe(1));

    const telemetry = recordTelemetry();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    telemetry.stop();

    expect(telemetry.find('bridge_stats_fetch_start')?.trigger).toBe('poll');
    expect(telemetry.find('bridge_stats_fetch_success')?.trigger).toBe('poll');
  });

  it('keeps working when the telemetry sink itself throws', async () => {
    resolveContracts(7n, 8n, 9n);

    // The guard in `dispatchTelemetry` covers failures in building or
    // dispatching the record — a listener's own exception is reported to the
    // global error handler by the DOM, not to the dispatcher.
    const dispatchSpy = vi
      .spyOn(window, 'dispatchEvent')
      .mockImplementation(() => {
        throw new Error('sink blew up');
      });

    try {
      const { result } = renderHook(() => useBridgeStats());
      await waitFor(() => expect(result.current.fetchCount).toBe(1));

      expect(dispatchSpy).toHaveBeenCalled();
      expect(result.current.balance).toBe(7n);
      expect(result.current.limit).toBe(8n);
      expect(result.current.totalDeposited).toBe(9n);
      expect(result.current.error).toBeNull();
    } finally {
      dispatchSpy.mockRestore();
    }
  });
});
