import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TransactionHistoryEntry } from '@/types';
import {
  KEYBOARD_SHORTCUTS,
  getAccessibleFilterChipTone,
  useTransactionFilters,
} from './useTransactionFilters';

const pushMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/receipts',
  useSearchParams: () => mockSearchParams,
}));

const sampleTransactions: TransactionHistoryEntry[] = [
  {
    id: 'tx-1',
    kind: 'deposit',
    status: 'completed',
    amount: '125',
    asset: 'XLM',
    message: 'Completed deposit',
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  },
  {
    id: 'tx-2',
    kind: 'payout',
    status: 'pending',
    amount: '80',
    asset: 'USDC',
    message: 'Pending payout',
    createdAt: new Date('2026-01-02T10:00:00.000Z'),
  },
  {
    id: 'tx-3',
    kind: 'risk_warning',
    status: 'failed',
    amount: '50',
    asset: 'AQUA',
    message: 'Failed withdrawal',
    createdAt: new Date('2026-01-03T10:00:00.000Z'),
  },
];

describe('useTransactionFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushMock.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('KEYBOARD_SHORTCUTS', () => {
    it('defines the expected shortcut bindings', () => {
      expect(KEYBOARD_SHORTCUTS.clearAll).toEqual({
        key: 'x',
        modifiers: 'Ctrl+Shift',
        description: 'Clear all filters',
      });
      expect(KEYBOARD_SHORTCUTS.cycleStatus.key).toBe('1');
      expect(KEYBOARD_SHORTCUTS.cycleAsset.key).toBe('2');
      expect(KEYBOARD_SHORTCUTS.cycleNetwork.key).toBe('3');
    });
  });

  describe('accessible chip tones', () => {
    it('uses an accessible emerald palette for completed status chips', () => {
      expect(getAccessibleFilterChipTone('status', 'completed', true)).toEqual({
        chipClassName:
          'border-transparent bg-emerald-700 text-white hover:bg-emerald-800 focus:ring-emerald-600 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200 dark:focus:ring-emerald-300',
        countClassName:
          'bg-emerald-900 text-emerald-50 dark:bg-emerald-950 dark:text-emerald-100',
      });
    });

    it('uses an accessible red palette for failed status chips', () => {
      const tone = getAccessibleFilterChipTone('status', 'failed', false);

      expect(tone.chipClassName).toContain('text-red-800');
      expect(tone.chipClassName).toContain('dark:text-red-200');
      expect(tone.countClassName).toContain('text-red-800');
    });

    it('assigns deterministic accessible tones for asset chips', () => {
      expect(getAccessibleFilterChipTone('asset', 'XLM', false)).toEqual(
        getAccessibleFilterChipTone('asset', 'XLM', false),
      );
      expect(getAccessibleFilterChipTone('asset', 'XLM', false)).not.toEqual(
        getAccessibleFilterChipTone('asset', 'USDC', false),
      );
    });

    it('assigns deterministic accessible tones for network chips', () => {
      expect(getAccessibleFilterChipTone('network', 'testnet', true)).toEqual(
        getAccessibleFilterChipTone('network', 'testnet', true),
      );
    });
  });

  describe('hook behavior', () => {
    it('hydrates the initial filter state from the URL', () => {
      mockSearchParams = new URLSearchParams('status=completed&asset=XLM');

      const { result } = renderHook(() =>
        useTransactionFilters(sampleTransactions),
      );

      expect(result.current.filterState).toEqual({
        status: ['completed'],
        asset: ['XLM'],
        network: [],
      });
      expect(result.current.filteredTransactions).toHaveLength(1);
      expect(result.current.filteredTransactions[0].id).toBe('tx-1');
    });

    it('debounces URL updates when toggling filters', () => {
      const { result } = renderHook(() =>
        useTransactionFilters(sampleTransactions),
      );

      act(() => {
        result.current.toggleFilter('status', 'completed');
      });

      expect(pushMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(pushMock).toHaveBeenCalledWith('/receipts?status=completed', {
        scroll: false,
      });
    });

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
    });
  });
});
