import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TransactionHistoryEntry } from '@/types';
import {
  KEYBOARD_SHORTCUTS,
  useTransactionFilters,
  getAccessibleFilterChipTone,
  ensureDarkModeClasses,
  withDarkModeFallback,
  DARK_MODE_FALLBACK_CLASSES,
} from './useTransactionFilters';

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
    });

    act(() => {
      vi.advanceTimersByTime(51);
    });

    act(() => {
      result.current.toggleFilter('asset', 'XLM');
    });

    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      '/transactions?tab=history&status=completed&asset=XLM',
      { scroll: false },
    );
  });

  it('clears all filters through the keyboard shortcut outside editable fields', () => {
    mockSearchParams = new URLSearchParams('status=completed');

    renderHook(() => useTransactionFilters(transactions));

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

    expect(mockPush).toHaveBeenCalledWith('/transactions', { scroll: false });
  });

  it('ignores keyboard shortcuts while typing in an input', () => {
    mockSearchParams = new URLSearchParams('status=completed');

    renderHook(() => useTransactionFilters(transactions));

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

    expect(mockPush).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('exposes the same accessible chip tone resolver through the hook', () => {
    const { result } = renderHook(() =>
      useTransactionFilters(transactions),
    );

    expect(
      result.current.getFilterChipTone('status', 'pending', true),
    ).toEqual(getAccessibleFilterChipTone('status', 'pending', true));
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

// ── Dark mode fallback (issue #671) ────────────────────────────────────────

describe('dark mode fallback for filter chip tones (issue #671)', () => {
  it('leaves classes untouched when a dark variant is already present', () => {
    const className = 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
    expect(ensureDarkModeClasses(className, DARK_MODE_FALLBACK_CLASSES.chipClassName)).toBe(
      className,
    );
  });

  it('appends fallback dark classes when none are present', () => {
    const result = ensureDarkModeClasses(
      'bg-blue-50 text-blue-800',
      DARK_MODE_FALLBACK_CLASSES.chipClassName,
    );
    expect(result).toBe(
      `bg-blue-50 text-blue-800 ${DARK_MODE_FALLBACK_CLASSES.chipClassName}`,
    );
    expect(result).toContain('dark:');
  });

  it('returns only the fallback classes for an empty className', () => {
    expect(ensureDarkModeClasses('', DARK_MODE_FALLBACK_CLASSES.countClassName)).toBe(
      DARK_MODE_FALLBACK_CLASSES.countClassName,
    );
  });

  it('backfills dark-mode classes on a tone missing them', () => {
    const tone = withDarkModeFallback({
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-800',
      countClassName: 'bg-blue-100 text-blue-800',
    });
    expect(tone.chipClassName).toContain('dark:');
    expect(tone.countClassName).toContain('dark:');
  });

  it('keeps built-in palette tones (which already define dark variants) unchanged', () => {
    const tone = getAccessibleFilterChipTone('status', 'completed', true);
    // Built-in tones already ship dark: classes, so no fallback should be appended.
    expect(tone.chipClassName).not.toContain(DARK_MODE_FALLBACK_CLASSES.chipClassName);
    expect(tone.chipClassName).toContain('dark:');
    expect(tone.countClassName).toContain('dark:');
  });
});
