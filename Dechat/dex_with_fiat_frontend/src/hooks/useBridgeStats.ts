'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearCache,
  getContractBalance,
  getBridgeLimit,
  getTotalDeposited,
} from '@/lib/stellarContract';

// ── Telemetry schema ──────────────────────────────────────────────────────

/** `window` event name every bridge-stats telemetry record is dispatched on. */
export const BRIDGE_STATS_TELEMETRY_EVENT = 'bridge_stats_telemetry';

/** Bump when the `detail` payload shape changes in a breaking way. */
export const BRIDGE_STATS_TELEMETRY_VERSION = '1.0.0';

/** What caused a fetch to run. */
export type BridgeStatsFetchTrigger =
  /** The hook's initial fetch on mount. */
  | 'mount'
  /** The 30-second background poll. */
  | 'poll'
  /** `refresh()` — an explicit user action that also clears the cache. */
  | 'manual'
  /** `refetchStats()` — a programmatic re-read by a consumer. */
  | 'programmatic';

/** Why an in-flight fetch's result was thrown away instead of applied. */
export type BridgeStatsDiscardReason =
  /** The hook unmounted while the request was in flight. */
  | 'unmounted'
  /** A newer fetch started before this one resolved. */
  | 'superseded';

export type BridgeStatsTelemetryName =
  | 'bridge_stats_mounted'
  | 'bridge_stats_unmounted'
  | 'bridge_stats_fetch_start'
  | 'bridge_stats_fetch_success'
  | 'bridge_stats_fetch_error'
  | 'bridge_stats_fetch_discarded'
  | 'bridge_stats_manual_refresh';

export interface BridgeStatsTelemetryDetail {
  /** Normalized event name. */
  event: BridgeStatsTelemetryName;
  /** Schema version for this payload shape. */
  version: string;
  /** Unix timestamp (ms) when the event was emitted. */
  timestamp: number;
  /** What kicked off the fetch this event belongs to, where applicable. */
  trigger?: BridgeStatsFetchTrigger;
  /** Wall-clock duration of the fetch, in ms, on success/error/discard. */
  durationMs?: number;
  /** Number of successful fetches this hook instance has completed. */
  fetchCount?: number;
  /**
   * Contract values as decimal strings. `bigint` is not JSON-serializable, so
   * emitting the raw values would make the payload unusable to any analytics
   * adapter that stringifies it.
   */
  balance?: string | null;
  limit?: string | null;
  totalDeposited?: string | null;
  /** Failure message on `bridge_stats_fetch_error`. */
  error?: string;
  /** Why a resolved fetch was discarded. */
  reason?: BridgeStatsDiscardReason;
  /** Lifetime of the hook instance, in ms, on `bridge_stats_unmounted`. */
  lifetimeMs?: number;
}

export type BridgeStats = {
  balance: bigint | null;
  limit: bigint | null;
  totalDeposited: bigint | null;
  loading: boolean;
  error: string | null;
  fetchCount: number;
  lastFetchedAt: Date | null;
  refetchStats: () => Promise<void>;
  refresh: () => Promise<void>;
};

const POLL_INTERVAL_MS = 30000;

function serializeAmount(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * Dispatch one telemetry record as a `CustomEvent` on `window`, so analytics
 * adapters and logging can subscribe without the hook depending on them.
 *
 * Never throws: telemetry is strictly observational, so a failure to build or
 * dispatch a record must not take the bridge-stats UI down with it. A
 * subscriber's own exception is the DOM's business — it surfaces on the global
 * error handler rather than reaching this caller.
 */
function dispatchTelemetry(
  event: BridgeStatsTelemetryName,
  detail?: Omit<BridgeStatsTelemetryDetail, 'event' | 'version' | 'timestamp'>,
) {
  if (typeof window === 'undefined') return;
  try {
    const payload: BridgeStatsTelemetryDetail = {
      event,
      version: BRIDGE_STATS_TELEMETRY_VERSION,
      timestamp: Date.now(),
      ...detail,
    };
    window.dispatchEvent(
      new CustomEvent<BridgeStatsTelemetryDetail>(BRIDGE_STATS_TELEMETRY_EVENT, {
        detail: payload,
      }),
    );
  } catch {
    // Swallow: a broken telemetry sink must never break the hook.
  }
}

export default function useBridgeStats(): BridgeStats {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [limit, setLimit] = useState<bigint | null>(null);
  const [totalDeposited, setTotalDeposited] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  // A client component may be rendered on the server before it is hydrated.
  // Keep async updates disabled until React has committed the client instance;
  // this makes the server snapshot and the first client render deterministic.
  const isMountedRef = useRef(false);
  const fetchIdRef = useRef(0);
  // Mirrors `fetchCount` so telemetry emitted from callbacks and from the
  // unmount cleanup reads the current value rather than a stale closure.
  const fetchCountRef = useRef(0);
  const mountedAtRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    mountedAtRef.current = Date.now();
    dispatchTelemetry('bridge_stats_mounted');
    return () => {
      isMountedRef.current = false;
      // Invalidate any request which was started by this mounted instance.
      // This also covers Strict Mode's mount/cleanup/remount cycle.
      fetchIdRef.current += 1;
    };
  }, []);

  const runFetch = useCallback(async (trigger: BridgeStatsFetchTrigger) => {
    if (!isMountedRef.current) return;
    const fetchId = ++fetchIdRef.current;
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    dispatchTelemetry('bridge_stats_fetch_start', { trigger });
    try {
      const [b, l, t] = await Promise.all([
        getContractBalance(),
        getBridgeLimit(),
        getTotalDeposited(),
      ]);
      if (!isMountedRef.current || fetchId !== fetchIdRef.current) {
        dispatchTelemetry('bridge_stats_fetch_discarded', {
          trigger,
          durationMs: Date.now() - startedAt,
          reason: isMountedRef.current ? 'superseded' : 'unmounted',
        });
        return;
      }
      setBalance(b);
      setLimit(l);
      setTotalDeposited(t);
      fetchCountRef.current += 1;
      setFetchCount(fetchCountRef.current);
      setLastFetchedAt(new Date());
      dispatchTelemetry('bridge_stats_fetch_success', {
        trigger,
        durationMs: Date.now() - startedAt,
        fetchCount: fetchCountRef.current,
        balance: serializeAmount(b),
        limit: serializeAmount(l),
        totalDeposited: serializeAmount(t),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isMountedRef.current || fetchId !== fetchIdRef.current) {
        dispatchTelemetry('bridge_stats_fetch_discarded', {
          trigger,
          durationMs: Date.now() - startedAt,
          reason: isMountedRef.current ? 'superseded' : 'unmounted',
          error: msg,
        });
        return;
      }
      setError(msg);
      dispatchTelemetry('bridge_stats_fetch_error', {
        trigger,
        durationMs: Date.now() - startedAt,
        error: msg,
      });
    } finally {
      if (isMountedRef.current && fetchId === fetchIdRef.current) setLoading(false);
    }
  }, []);

  const refetchStats = useCallback(() => runFetch('programmatic'), [runFetch]);

  const refresh = useCallback(async () => {
    dispatchTelemetry('bridge_stats_manual_refresh');
    clearCache();
    await runFetch('manual');
  }, [runFetch]);

  // Initial fetch and 30-second polling
  useEffect(() => {
    void runFetch('mount');

    const interval = setInterval(() => {
      void runFetch('poll');
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [runFetch]);

  return {
    balance,
    limit,
    totalDeposited,
    loading,
    error,
    fetchCount,
    lastFetchedAt,
    refetchStats,
    refresh,
  };
}
