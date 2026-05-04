/**
 * Unit tests for ReceiptDrawer keyboard shortcuts (issue #528).
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReceiptDrawer from '../ReceiptDrawer';

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('@/hooks/useTransactionFilters', () => ({
  useTransactionFilters: (txs: unknown[]) => ({
    filterState: {},
    filteredTransactions: txs,
    filterStats: {},
    toggleFilter: vi.fn(),
    clearAllFilters: vi.fn(),
  }),
}));

vi.mock('./filters/FilterChipBar', () => ({
  FilterChipBar: () => null,
}));

vi.mock('../components/ui/skeleton/SkeletonReceipt', () => ({
  default: () => <div data-testid="skeleton" />,
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  transactions: [],
  onClearHistory: vi.fn(),
};

describe('ReceiptDrawer keyboard shortcuts (#528)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Escape key calls onClose', () => {
    render(<ReceiptDrawer {...defaultProps} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('Backspace key calls onClearHistory', () => {
    render(<ReceiptDrawer {...defaultProps} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'Backspace' });
    });
    expect(defaultProps.onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('Delete key calls onClearHistory', () => {
    render(<ReceiptDrawer {...defaultProps} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'Delete' });
    });
    expect(defaultProps.onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('keyboard shortcuts are ignored when drawer is closed', () => {
    render(<ReceiptDrawer {...defaultProps} isOpen={false} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.keyDown(document, { key: 'Backspace' });
    });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    expect(defaultProps.onClearHistory).not.toHaveBeenCalled();
  });

  it('Backspace does nothing when onClearHistory is not provided', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onClearHistory, ...propsWithoutClear } = defaultProps;
    expect(() => {
      render(<ReceiptDrawer {...propsWithoutClear} />);
      act(() => {
        fireEvent.keyDown(document, { key: 'Backspace' });
      });
    }).not.toThrow();
  });

  it('drawer has correct aria attributes for accessibility', () => {
    const { getByRole } = render(<ReceiptDrawer {...defaultProps} />);
    const dialog = getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
