import { filterTransactions } from '@/lib/transactionFilters';
import type { FilterState, TransactionHistoryEntry } from '@/types';

const mockTransactions: Array<TransactionHistoryEntry & { network: string }> = [
  {
    id: '1',
    kind: 'deposit',
    asset: 'XLM',
    network: 'testnet',
    status: 'completed',
    message: 'Deposit complete',
    createdAt: new Date('2023-10-01'),
  },
  {
    id: '2',
    kind: 'payout',
    asset: 'USDC',
    network: 'mainnet',
    status: 'pending',
    message: 'Payout pending',
    createdAt: new Date('2023-10-15'),
  },
  {
    id: '3',
    kind: 'deposit',
    asset: 'XLM',
    network: 'mainnet',
    status: 'completed',
    message: 'Deposit complete',
    createdAt: new Date('2023-11-01'),
  },
];

describe('transactionFilters utility', () => {
  const defaultFilters: FilterState = { status: [], asset: [], network: [] };

  test('returns all transactions when no filters are applied', () => {
    expect(filterTransactions(mockTransactions, defaultFilters)).toEqual(
      mockTransactions,
    );
  });

  test('filters by status', () => {
    const filters: FilterState = { ...defaultFilters, status: ['completed'] };
    expect(filterTransactions(mockTransactions, filters)).toEqual([
      mockTransactions[0],
      mockTransactions[2],
    ]);
  });

  test('filters by network', () => {
    const filters: FilterState = { ...defaultFilters, network: ['testnet'] };
    expect(filterTransactions(mockTransactions, filters)).toEqual([
      mockTransactions[0],
    ]);
  });

  test('filters by asset', () => {
    const filters: FilterState = { ...defaultFilters, asset: ['USDC'] };
    expect(filterTransactions(mockTransactions, filters)).toEqual([
      mockTransactions[1],
    ]);
  });

  test('combines filter categories', () => {
    const filters: FilterState = {
      status: ['completed'],
      asset: ['XLM'],
      network: ['mainnet'],
    };
    expect(filterTransactions(mockTransactions, filters)).toEqual([
      mockTransactions[2],
    ]);
  });

  test('returns an empty array when no transactions match', () => {
    const filters: FilterState = {
      ...defaultFilters,
      status: ['pending'],
      asset: ['XLM'],
    };
    expect(filterTransactions(mockTransactions, filters)).toEqual([]);
  });

  test('handles an empty transaction list', () => {
    expect(filterTransactions([], defaultFilters)).toEqual([]);
  });
});
