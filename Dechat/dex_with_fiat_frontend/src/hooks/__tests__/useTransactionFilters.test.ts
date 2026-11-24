import { renderHook, act } from '@testing-library/react';
import { useTransactionFilters } from '@/hooks/useTransactionFilters';
import type { TransactionHistoryEntry } from '@/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/chat',
  useSearchParams: () => new URLSearchParams(),
}));

const mockTransactions: TransactionHistoryEntry[] = [
  {
    id: '1',
    kind: 'deposit',
    asset: 'XLM',
    status: 'completed',
    message: 'Deposit complete',
    createdAt: new Date('2023-10-01'),
  },
  {
    id: '2',
    kind: 'payout',
    asset: 'USDC',
    status: 'pending',
    message: 'Payout pending',
    createdAt: new Date('2023-10-02'),
  },
];

describe('useTransactionFilters hook', () => {
  it('initializes with all transactions and empty filters', () => {
    const { result } = renderHook(() =>
      useTransactionFilters(mockTransactions),
    );
    expect(result.current.filteredTransactions).toEqual(mockTransactions);
    expect(result.current.filterState).toEqual({
      status: [],
      asset: [],
      network: [],
    });
  });

  it('filters transactions immediately when a status is selected', () => {
    const { result } = renderHook(() =>
      useTransactionFilters(mockTransactions),
    );

    act(() => result.current.toggleFilter('status', 'completed'));

    expect(result.current.filteredTransactions).toEqual([mockTransactions[0]]);
    expect(result.current.filterState.status).toEqual(['completed']);
  });

  it('clears all active filters', () => {
    const { result } = renderHook(() =>
      useTransactionFilters(mockTransactions),
    );

    act(() => result.current.toggleFilter('status', 'pending'));
    act(() => result.current.toggleFilter('asset', 'XLM'));
    expect(result.current.filteredTransactions).toEqual([]);

    act(() => result.current.clearAllFilters());

    expect(result.current.filteredTransactions).toEqual(mockTransactions);
    expect(result.current.filterState).toEqual({
      status: [],
      asset: [],
      network: [],
    });
  });
});
