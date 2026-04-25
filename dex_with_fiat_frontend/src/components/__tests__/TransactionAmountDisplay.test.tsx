import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { TransactionAmountDisplay } from '../TransactionAmountDisplay';

// Mock the hook
vi.mock('@/hooks/useCurrencyConversion', () => ({
  useCurrencyConversion: vi.fn((amount, asset) => ({
    displayText: amount ? `${amount} ${asset} ≈ $12.40 USD` : '',
    originalAmount: amount,
    originalCurrency: asset,
    fiatAmount: 12.4,
    fiatCurrency: 'USD',
    isLoading: false,
    hasError: false,
  })),
}));

describe('TransactionAmountDisplay', () => {
  afterEach(cleanup);

  it('renders correctly with valid numeric amount', () => {
    render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    expect(screen.getByText(/100 XLM ≈ \$12\.40 USD/i)).toBeDefined();
  });

  it('renders correctly with valid string amount', () => {
    render(<TransactionAmountDisplay amount="50" asset="USDC" />);
    expect(screen.getByText(/50 USDC ≈ \$12\.40 USD/i)).toBeDefined();
  });

  it('shows stored fiat when provided', () => {
    render(
      <TransactionAmountDisplay 
        amount={100} 
        asset="XLM" 
        fiatAmount="12.40" 
        fiatCurrency="USD" 
      />
    );
    expect(screen.getByText(/Stored fiat: 12.40 USD/i)).toBeDefined();
  });

  it('defaults asset to XLM if not provided', () => {
    render(<TransactionAmountDisplay amount={100} />);
    expect(screen.getByText(/100 XLM ≈ \$12\.40 USD/i)).toBeDefined();
  });

  it('displays error message for invalid data type', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Passing an object where a number/string is expected
    // @ts-expect-error - testing invalid props
    render(<TransactionAmountDisplay amount={{ val: 100 }} />);
    
    // Zod returns a specific message for type mismatch
    expect(screen.getByText(/Expected/i)).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('displays error for zero amount', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TransactionAmountDisplay amount={0} />);
    expect(screen.getByText(/Amount must be positive/i)).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('displays error for negative amount', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TransactionAmountDisplay amount={-50} />);
    expect(screen.getByText(/Amount must be positive/i)).toBeDefined();
    consoleSpy.mockRestore();
  });

  // ── Auto-scroll behaviour (issue #522) ────────────────────────────────

  it('calls scrollIntoView on mount', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<TransactionAmountDisplay amount={100} asset="XLM" />);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('calls scrollIntoView again when displayText changes', async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { useCurrencyConversion } = await import('@/hooks/useCurrencyConversion');
    const mockHook = vi.mocked(useCurrencyConversion);

    mockHook.mockReturnValueOnce({
      displayText: '100 XLM ≈ $12.40 USD',
      originalAmount: 100,
      originalCurrency: 'XLM',
      fiatAmount: 12.4,
      fiatCurrency: 'USD',
      isLoading: false,
      hasError: false,
    });

    const { rerender } = render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    const callsBefore = scrollIntoView.mock.calls.length;

    mockHook.mockReturnValueOnce({
      displayText: '200 XLM ≈ $24.80 USD',
      originalAmount: 200,
      originalCurrency: 'XLM',
      fiatAmount: 24.8,
      fiatCurrency: 'USD',
      isLoading: false,
      hasError: false,
    });

    await act(async () => {
      rerender(<TransactionAmountDisplay amount={200} asset="XLM" />);
    });

    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
