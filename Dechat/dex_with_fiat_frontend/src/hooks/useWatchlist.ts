'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'stellar_watchlist';

export interface WatchedAddress {
  id: string;
  address: string;
  label: string;
}

function loadFromStorage(): WatchedAddress[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as WatchedAddress[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(list: WatchedAddress[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchedAddress[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setWatchlist(loadFromStorage());
    setIsLoaded(true);
  }, []);

  const addAddress = useCallback((address: string, label: string) => {
    setWatchlist((prev) => {
      if (prev.some((w) => w.address === address)) return prev;
      const next = [
        ...prev,
        { id: crypto.randomUUID(), address: address.trim(), label: label.trim() || address.slice(0, 8) },
      ];
      saveToStorage(next);
      return next;
    });
  }, []);

  const removeAddress = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = prev.filter((w) => w.id !== id);
      saveToStorage(next);
      return next;
    });
  }, []);

  return { watchlist, isLoaded, addAddress, removeAddress };
}
