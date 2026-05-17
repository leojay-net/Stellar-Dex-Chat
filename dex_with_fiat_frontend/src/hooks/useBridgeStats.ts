import { useCallback, useEffect, useState } from 'react';
import {
  clearCache,
  getContractBalance,
  getBridgeLimit,
  getTotalDeposited,
} from '@/lib/stellarContract';
import {
  chatTelemetry,
  type BridgeStatsTelemetryPayload,
  type BridgeStatsTelemetrySource,
} from '@/lib/chatTelemetry';

export type BridgeStats = {
  balance: bigint | null;
  limit: bigint | null;
  totalDeposited: bigint | null;
  loading: boolean;
  error: string | null;
  refetchStats: () => Promise<void>;
  refresh: () => Promise<void>;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function trackBridgeStatsFetch(payload: BridgeStatsTelemetryPayload): void {
  try {
    chatTelemetry.bridgeStatsFetch(payload);
  } catch {
    // Telemetry should never interrupt bridge stats loading.
  }
}

export default function useBridgeStats(): BridgeStats {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [limit, setLimit] = useState<bigint | null>(null);
  const [totalDeposited, setTotalDeposited] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (source: BridgeStatsTelemetrySource) => {
    const startedAt = Date.now();

    setLoading(true);
    setError(null);

    try {
      const [b, l, t] = await Promise.all([
        getContractBalance(),
        getBridgeLimit(),
        getTotalDeposited(),
      ]);
      setBalance(b);
      setLimit(l);
      setTotalDeposited(t);

      trackBridgeStatsFetch({
        source,
        success: true,
        durationMs: Date.now() - startedAt,
        hasBalance: b !== null,
        hasLimit: l !== null,
        hasTotalDeposited: t !== null,
      });
    } catch (err) {
      const errorMessage = getErrorMessage(err);

      setError(errorMessage);
      trackBridgeStatsFetch({
        source,
        success: false,
        durationMs: Date.now() - startedAt,
        hasBalance: false,
        hasLimit: false,
        hasTotalDeposited: false,
        errorMessage,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const refetchStats = useCallback(async () => {
    await fetchStats('auto');
  }, [fetchStats]);

  const refresh = useCallback(async () => {
    clearCache();
    await fetchStats('manual');
  }, [fetchStats]);

  // Initial fetch and 30-second polling
  useEffect(() => {
    void refetchStats();

    const interval = setInterval(() => {
      void refetchStats();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [refetchStats]);

  return {
    balance,
    limit,
    totalDeposited,
    loading,
    error,
    refetchStats,
    refresh,
  };
}
