import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TransactionHistoryEntry } from '@/types';
import { KEYBOARD_SHORTCUTS, useTransactionFilters } from './useTransactionFilters';

let mockSearchParams = new URLSearchParams('tab=history');
const mockPush = vi.fn((url: string) => {
  const query = url.split('?')[1] ?? '';
  mockSearchParams = new URLSearchParams(query);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/transactions',
  useSearchParams: () => mockSearchParams,
}));

const transactions: TransactionHistoryEntry[] = [
  {
    id: '1',
    kind: 'deposit',
    status: 'completed',
    asset: 'XLM',
    message: 'Deposit completed',
    createdAt: new Date('2026-01-01T10:00:00Z'),
  },
  {
    id: '2',
    kind: 'payout',
    status: 'failed',
    asset: 'USDC',
    message: 'Payout failed',
    createdAt: new Date('2026-01-02T10:00:00Z'),
  },
];

describe('useTransactionFilters', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams('tab=history');
    mockPush.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('debounces URL updates and combines rapid filter toggles', () => {
    const { result } = renderHook(() => useTransactionFilters(transactions));

    act(() => {
      result.current.toggleFilter('status', 'completed');
      result.current.toggleFilter('asset', 'XLM');
    });

    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(mockPush).not.toHaveBeenCalled();

    it('clears all filters through the keyboard shortcut outside editable fields', () => {
      mockSearchParams = new URLSearchParams('status=completed');

      renderHook(() => useTransactionFilters(sampleTransactions));

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'x',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
      });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(pushMock).toHaveBeenCalledWith('/receipts', { scroll: false });
    });

    it('ignores keyboard shortcuts while typing in an input', () => {
      mockSearchParams = new URLSearchParams('status=completed');

      renderHook(() => useTransactionFilters(sampleTransactions));

      const input = document.createElement('input');
      document.body.appendChild(input);

      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'x',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
        vi.advanceTimersByTime(150);
      });

      expect(pushMock).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('exposes the same accessible chip tone resolver through the hook', () => {
      const { result } = renderHook(() =>
        useTransactionFilters(sampleTransactions),
      );

      expect(
        result.current.getFilterChipTone('status', 'pending', true),
      ).toEqual(getAccessibleFilterChipTone('status', 'pending', true));
    })
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      '/transactions?tab=history&status=completed&asset=XLM',
      { scroll: false },
    );
  });

  it('applies pending filter state immediately before debounce flush', () => {
    const { result } = renderHook(() => useTransactionFilters(transactions));

    expect(result.current.filteredTransactions).toHaveLength(2);

    act(() => {
      result.current.toggleFilter('status', 'completed');
    });

    // UI should reflect optimistic filter state immediately.
    expect(result.current.filteredTransactions).toHaveLength(1);
    expect(result.current.filteredTransactions[0]?.status).toBe('completed');
  });

  it('keeps keyboard shortcut metadata intact', () => {
    expect(KEYBOARD_SHORTCUTS.clearAll.key).toBe('x');
    expect(KEYBOARD_SHORTCUTS.cycleStatus.key).toBe('1');
    expect(KEYBOARD_SHORTCUTS.cycleAsset.key).toBe('2');
    expect(KEYBOARD_SHORTCUTS.cycleNetwork.key).toBe('3');

  });
});
