'use client';

import { useSyncExternalStore } from 'react';
import { TransactionHistoryEntry } from '@/types';

const TX_HISTORY_KEY = 'stellar_tx_history';

class TxHistoryStore {
  private entries: TransactionHistoryEntry[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = localStorage.getItem(TX_HISTORY_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Array<
        Omit<TransactionHistoryEntry, 'createdAt'> & { createdAt: string }
      >;
      this.entries = parsed.map((entry) => ({
        ...entry,
        createdAt: new Date(entry.createdAt),
      }));
    } catch {
      this.entries = [];
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener());

    if (typeof window !== 'undefined') {
      localStorage.setItem(TX_HISTORY_KEY, this.exportEntries());
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return this.entries;
  }

  addEntry(entry: Omit<TransactionHistoryEntry, 'id' | 'createdAt'>) {
    const nextEntry: TransactionHistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };

    this.entries = [nextEntry, ...this.entries].slice(0, 100);
    this.emit();
    return nextEntry;
  }

  updateEntry(id: string, updates: Partial<TransactionHistoryEntry>) {
    this.entries = this.entries.map((entry) =>
      entry.id === id ? { ...entry, ...updates } : entry,
    );
    this.emit();
  }

  clearEntries() {
    this.entries = [];
    this.emit();
  }

  exportEntries() {
    return JSON.stringify(
      this.entries.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
      null,
      2,
    );
  }
}

const txHistoryStore = new TxHistoryStore();

export function useTxHistory() {
  const entries = useSyncExternalStore(
    (listener) => txHistoryStore.subscribe(listener),
    () => txHistoryStore.getSnapshot(),
    () => [],
  );

  return {
    entries,
    addEntry: txHistoryStore.addEntry.bind(txHistoryStore),
    updateEntry: txHistoryStore.updateEntry.bind(txHistoryStore),
    clearEntries: txHistoryStore.clearEntries.bind(txHistoryStore),
    exportEntries: txHistoryStore.exportEntries.bind(txHistoryStore),
  };
}
