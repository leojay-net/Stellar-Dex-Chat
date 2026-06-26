import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearCache,
  getContractBalance,
  getBridgeLimit,
  getTotalDeposited,
} from '@/lib/stellarContract';

export type BridgeStats = {
  balance: bigint | null;
  limit: bigint | null;
  totalDeposited: bigint | null;
  loading: boolean;
  error: string | null;
  refetchStats: () => Promise<void>;
  refresh: () => Promise<void>;
};

export default function useBridgeStats(): BridgeStats {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [limit, setLimit] = useState<bigint | null>(null);
  const [totalDeposited, setTotalDeposited] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refetchStats = useCallback(async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const [b, l, t] = await Promise.all([
        getContractBalance(),
        getBridgeLimit(),
        getTotalDeposited(),
      ]);
      if (!isMountedRef.current) return;
      setBalance(b);
      setLimit(l);
      setTotalDeposited(t);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    clearCache();
    await refetchStats();
  }, [refetchStats]);

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
