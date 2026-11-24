'use client';

import { useEffect, useRef } from 'react';
import { WatchedAddress } from '@/hooks/useWatchlist';
import { toastStore } from '@/lib/toastStore';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const POLL_INTERVAL_MS = 30_000;

type PaymentRecord = {
  id: string;
  type: string;
  to?: string;
  amount?: string;
  asset_type?: string;
};

type HorizonPaymentsResponse = {
  _embedded?: { records?: PaymentRecord[] };
};

function browserNotify(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/favicon.ico' });
  } catch {
    // silently ignore
  }
}

async function fetchPayments(address: string, limit = 5): Promise<PaymentRecord[]> {
  try {
    const res = await fetch(
      `${HORIZON_URL}/accounts/${encodeURIComponent(address)}/payments?order=desc&limit=${limit}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as HorizonPaymentsResponse;
    return data._embedded?.records ?? [];
  } catch {
    return [];
  }
}

export function useWatchedWalletNotifications(watchlist: WatchedAddress[]) {
  const lastSeenRef = useRef<Map<string, string | null>>(new Map());
  const initializedRef = useRef<Set<string>>(new Set());
  const watchlistKey = watchlist.map((w) => w.id).join(',');

  useEffect(() => {
    if (watchlist.length === 0) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      for (const entry of watchlist) {
        if (cancelled) break;
        if (!initializedRef.current.has(entry.id)) continue;

        const lastId = lastSeenRef.current.get(entry.id) ?? null;
        const records = await fetchPayments(entry.address);
        if (cancelled) break;

        const newest = records[0]?.id ?? null;
        if (!newest || newest === lastId) continue;

        const incoming = records.find(
          (r) => r.to === entry.address && r.id !== lastId,
        );

        lastSeenRef.current.set(entry.id, newest);

        if (incoming) {
          const label = entry.label || `${entry.address.slice(0, 6)}…`;
          const amt = incoming.amount
            ? `${incoming.amount}${incoming.asset_type === 'native' ? ' XLM' : ''}`
            : '';
          const msg = amt ? `${label} received ${amt}` : `${label} received funds`;
          toastStore.addToast({ message: msg, variant: 'success' });
          browserNotify('Incoming Deposit', msg);
        }
      }
    };

    const init = async () => {
      for (const entry of watchlist) {
        if (cancelled) return;
        if (initializedRef.current.has(entry.id)) continue;
        const records = await fetchPayments(entry.address, 1);
        if (cancelled) return;
        lastSeenRef.current.set(entry.id, records[0]?.id ?? null);
        initializedRef.current.add(entry.id);
      }

      if (!cancelled) {
        intervalId = setInterval(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistKey]);
}
