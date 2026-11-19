import { describe, expect, test } from 'vitest';
import {
  computeFilterStats,
  filterTransactions,
} from '@/lib/transactionFilters';
import type { FilterState, TransactionHistoryEntry } from '@/types';

type NetworkedEntry = TransactionHistoryEntry & { network?: string };

const mockTransactions: NetworkedEntry[] = [
  {
    id: '1',
    kind: 'deposit',
    status: 'completed',
    asset: 'XLM',
    amount: '100',
    message: 'Deposit completed',
    createdAt: new Date('2023-10-01'),
    network: 'stellar-testnet',
  },
  {
    id: '2',
    kind: 'payout',
    status: 'pending',
    asset: 'USDC',
    amount: '500',
    message: 'Payout pending',
    createdAt: new Date('2023-10-15'),
    network: 'stellar-mainnet',
  },
  {
    id: '3',
    kind: 'deposit',
    status: 'failed',
    asset: 'XLM',
    amount: '1000',
    message: 'Deposit failed',
    createdAt: new Date('2023-11-01'),
    network: 'stellar-testnet',
  },
];

const noFilters: FilterState = { status: [], asset: [], network: [] };

describe('filterTransactions', () => {
  test('returns all transactions when no filters are applied', () => {
    const result = filterTransactions(mockTransactions, noFilters);
    expect(result).toHaveLength(3);
  });

  test('filters by status', () => {
    const result = filterTransactions(mockTransactions, {
      ...noFilters,
      status: ['completed'],
    });
    expect(result.map((t) => t.id)).toEqual(['1']);
  });

  test('uses OR logic within a category', () => {
    const result = filterTransactions(mockTransactions, {
      ...noFilters,
      status: ['completed', 'failed'],
    });
    expect(result.map((t) => t.id)).toEqual(['1', '3']);
  });

  test('filters by asset', () => {
    const result = filterTransactions(mockTransactions, {
      ...noFilters,
      asset: ['XLM'],
    });
    expect(result.map((t) => t.id)).toEqual(['1', '3']);
  });

  test('filters by network', () => {
    const result = filterTransactions(mockTransactions, {
      ...noFilters,
      network: ['stellar-mainnet'],
    });
    expect(result.map((t) => t.id)).toEqual(['2']);
  });

  test('uses AND logic between categories', () => {
    const result = filterTransactions(mockTransactions, {
      status: ['failed'],
      asset: ['XLM'],
      network: ['stellar-testnet'],
    });
    expect(result.map((t) => t.id)).toEqual(['3']);
  });

  test('returns an empty array when no transactions match', () => {
    const result = filterTransactions(mockTransactions, {
      status: ['completed'],
      asset: ['USDC'],
      network: [],
    });
    expect(result).toHaveLength(0);
  });

  test('handles an empty transaction list', () => {
    expect(filterTransactions([], noFilters)).toHaveLength(0);
  });
});

describe('computeFilterStats', () => {
  test('counts options and reports totals', () => {
    const stats = computeFilterStats(mockTransactions, {
      ...noFilters,
      asset: ['XLM'],
    });
    expect(stats.totalCount).toBe(3);
    expect(stats.filteredCount).toBe(2);
    expect(stats.assetOptions).toEqual([
      { value: 'USDC', label: 'USDC', count: 1 },
      { value: 'XLM', label: 'XLM', count: 2 },
    ]);
    expect(stats.statusOptions.map((o) => o.label)).toEqual([
      'Completed',
      'Failed',
      'Pending',
    ]);
    expect(stats.networkOptions).toEqual([
      { value: 'stellar-mainnet', label: 'Stellar Mainnet', count: 1 },
      { value: 'stellar-testnet', label: 'Stellar Testnet', count: 2 },
    ]);
  });
});
