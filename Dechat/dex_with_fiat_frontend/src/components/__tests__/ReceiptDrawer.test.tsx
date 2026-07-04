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
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
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

vi.mock('../ReceiptQrCode', () => ({
  default: ({ value }: { value: string }) => (
    <img data-testid="receipt-qr-code" alt="QR" src={`qr:${value}`} />
  ),
}));

const sampleTransaction = {
  id: 'tx-001',
  kind: 'deposit' as const,
  status: 'completed' as const,
  amount: '100',
  asset: 'USDC',
  txHash: 'abc123def4567890123456789012345678901234567890123456789012345678',
  message: 'Deposit completed',
  createdAt: new Date('2025-06-01T12:00:00Z'),
};

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

describe('ReceiptDrawer print styles', () => {
  beforeEach(() => {
    document.getElementById('receipt-print-styles')?.remove();
  });

  it('injects @media print styles into document head on mount', () => {
    render(<ReceiptDrawer {...defaultProps} />);
    const styleEl = document.getElementById('receipt-print-styles');
    expect(styleEl).toBeTruthy();
    expect(styleEl?.textContent).toContain('@media print');
    expect(styleEl?.textContent).toContain('.receipt-drawer-backdrop');
    expect(styleEl?.textContent).toContain('.receipt-qr-code');
  });

  it('print button calls window.print when receipts exist', async () => {
    vi.useFakeTimers();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { getByRole } = render(
      <ReceiptDrawer {...defaultProps} transactions={[sampleTransaction]} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    act(() => {
      getByRole('button', { name: 'Print transaction receipts' }).click();
    });

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
    vi.useRealTimers();
  });

  it('renders QR code for each transaction receipt', async () => {
    vi.useFakeTimers();
    const { getAllByTestId } = render(
      <ReceiptDrawer {...defaultProps} transactions={[sampleTransaction]} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    const qrCodes = getAllByTestId('receipt-qr-code');
    expect(qrCodes).toHaveLength(1);
    expect(qrCodes[0].getAttribute('src')).toContain('stellar.expert');
    vi.useRealTimers();
  });
});
