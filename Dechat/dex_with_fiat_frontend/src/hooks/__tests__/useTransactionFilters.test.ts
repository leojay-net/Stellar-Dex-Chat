import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTransactionFilters } from '@/hooks/useTransactionFilters';
import type { TransactionHistoryEntry } from '@/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

const transactions: TransactionHistoryEntry[] = [
  {
    id: '1',
    kind: 'deposit',
    status: 'completed',
    asset: 'XLM',
    message: 'Deposit completed',
    createdAt: new Date('2023-10-01'),
  },
  {
    id: '2',
    kind: 'payout',
    status: 'pending',
    asset: 'USDC',
    message: 'Payout pending',
    createdAt: new Date('2023-10-15'),
  },
];

describe('useTransactionFilters hook', () => {
  it('starts with the supplied transactions and empty selections', () => {
    const { result } = renderHook(() => useTransactionFilters(transactions));

    expect(result.current.filteredTransactions).toEqual(transactions);
    expect(result.current.filterState).toEqual({
      status: [],
      asset: [],
      network: [],
    });
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('shows only transactions matching the selected status', () => {
    const { result } = renderHook(() => useTransactionFilters(transactions));

    act(() => result.current.toggleFilter('status', 'completed'));

    expect(result.current.filteredTransactions).toEqual([transactions[0]]);
    expect(result.current.filterState.status).toEqual(['completed']);
  });

  it('clears all selected categories and restores every transaction', () => {
    const { result } = renderHook(() => useTransactionFilters(transactions));

    act(() => {
      result.current.toggleFilter('status', 'pending');
      result.current.toggleFilter('asset', 'XLM');
    });
    expect(result.current.filteredTransactions).toEqual([]);

    act(() => result.current.clearAllFilters());

    expect(result.current.filteredTransactions).toEqual(transactions);
    expect(result.current.filterState).toEqual({
      status: [],
      asset: [],
      network: [],
    });
  });
});
