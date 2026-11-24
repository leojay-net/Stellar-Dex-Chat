import { describe, expect, it } from 'vitest';
import { filterTransactions } from '@/lib/transactionFilters';
import type { FilterState, TransactionHistoryEntry } from '@/types';

const transactions: (TransactionHistoryEntry & { network?: string })[] = [
  {
    id: '1',
    kind: 'deposit',
    status: 'completed',
    asset: 'XLM',
    message: 'Deposit completed',
    createdAt: new Date('2023-10-01'),
    network: 'stellar-testnet',
  },
  {
    id: '2',
    kind: 'payout',
    status: 'pending',
    asset: 'USDC',
    message: 'Payout pending',
    createdAt: new Date('2023-10-15'),
    network: 'stellar-mainnet',
  },
  {
    id: '3',
    kind: 'deposit',
    status: 'failed',
    asset: 'XLM',
    message: 'Deposit failed',
    createdAt: new Date('2023-11-01'),
  },
];
const emptyFilters: FilterState = { status: [], asset: [], network: [] };

describe('transactionFilters utility', () => {
  it('returns all transactions when no filters are applied', () => {
    expect(filterTransactions(transactions, emptyFilters)).toEqual(
      transactions,
    );
  });

  it('matches either selected status', () => {
    const filters: FilterState = {
      ...emptyFilters,
      status: ['completed', 'failed'],
    };
    expect(filterTransactions(transactions, filters)).toEqual([
      transactions[0],
      transactions[2],
    ]);
  });

  it('filters by asset', () => {
    const filters = { ...emptyFilters, asset: ['USDC'] };
    expect(filterTransactions(transactions, filters)).toEqual([
      transactions[1],
    ]);
  });

  it('filters by network and excludes entries without a network', () => {
    const filters = { ...emptyFilters, network: ['stellar-testnet'] };
    expect(filterTransactions(transactions, filters)).toEqual([
      transactions[0],
    ]);
  });

  it('requires a match in every selected category', () => {
    const filters: FilterState = {
      status: ['pending', 'failed'],
      asset: ['XLM'],
      network: [],
    };
    expect(filterTransactions(transactions, filters)).toEqual([
      transactions[2],
    ]);
  });

  it('returns an empty array when no transaction matches', () => {
    const filters: FilterState = {
      ...emptyFilters,
      status: ['failed'],
      asset: ['USDC'],
    };
    expect(filterTransactions(transactions, filters)).toEqual([]);
  });

  it('handles an empty transaction list', () => {
    expect(filterTransactions([], emptyFilters)).toEqual([]);
  });
});
