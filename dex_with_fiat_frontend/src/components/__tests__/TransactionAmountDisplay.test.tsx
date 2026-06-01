import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
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

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: React.PropsWithChildren) => <span {...props}>{children}</span>,
  },
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

    // Zod returns "Invalid input" for type mismatch
    expect(screen.getByText(/Invalid input/i)).toBeDefined();
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

// ── Dynamic theme tokens (issue #593) ──────────────────────────────────
describe('TransactionAmountDisplay - dynamic theme tokens', () => {
  afterEach(cleanup);

  it('renders the amount with the primary theme token instead of hardcoded colours', () => {
    render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    const amountText = screen.getByText(/100 XLM ≈ \$12\.40 USD/i);
    expect(amountText).toHaveClass('theme-text-primary');
    expect(amountText.className).not.toMatch(/text-gray-300/);
  });

  it('renders the stored fiat line with the muted theme token', () => {
    render(
      <TransactionAmountDisplay
        amount={100}
        asset="XLM"
        fiatAmount="12.40"
        fiatCurrency="USD"
      />
    );
    const storedFiat = screen.getByText(/Stored fiat: 12.40 USD/i);
    expect(storedFiat).toHaveClass('theme-text-muted');
    expect(storedFiat.className).not.toMatch(/text-gray-(400|500)/);
  });
});

// ── Themed error border colour (issue #596) ─────────────────────────────
describe('TransactionAmountDisplay - error border colour', () => {
  afterEach(cleanup);

  it('renders the error state with a themed danger border', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TransactionAmountDisplay amount={0} />);
    const errorMessage = screen.getByText(/Amount must be positive/i);
    expect(errorMessage).toHaveClass('theme-soft-danger');
    expect(errorMessage).toHaveClass('border');
    expect(errorMessage.className).not.toMatch(/text-red-500/);
    consoleSpy.mockRestore();
  });
});

describe('TransactionAmountDisplay - Framer Motion Animations', () => {
  afterEach(cleanup);

  it('renders with motion.div wrapper for container animation', () => {
    const { container } = render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    const wrapper = container.querySelector('.flex.flex-col');
    expect(wrapper).toBeInTheDocument();
  });

  it('renders with motion.span for display text animation', () => {
    render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    const displayText = screen.getByText(/100 XLM ≈ \$12\.40 USD/i);
    expect(displayText).toBeInTheDocument();
    expect(displayText.tagName).toBe('SPAN');
  });

  it('renders with motion.span for stored fiat animation', () => {
    render(
      <TransactionAmountDisplay
        amount={100}
        asset="XLM"
        fiatAmount="12.40"
        fiatCurrency="USD"
      />
    );
    const storedFiat = screen.getByText(/Stored fiat: 12.40 USD/i);
    expect(storedFiat).toBeInTheDocument();
    expect(storedFiat.tagName).toBe('SPAN');
  });

  it('applies animation props to error state', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TransactionAmountDisplay amount={0} />);
    const errorMessage = screen.getByText(/Amount must be positive/i);
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage.tagName).toBe('SPAN');
    consoleSpy.mockRestore();
  });

  it('maintains correct structure with animations for valid data', () => {
    const { container } = render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    const wrapper = container.querySelector('.flex.flex-col');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper?.children.length).toBeGreaterThan(0);
  });

  it('handles value changes with key prop for animation', () => {
    const { rerender } = render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    const displayText1 = screen.getByText(/100 XLM ≈ \$12\.40 USD/i);
    expect(displayText1).toBeInTheDocument();

    // Rerender with different amount
    rerender(<TransactionAmountDisplay amount={200} asset="XLM" />);
    const displayText2 = screen.getByText(/200 XLM ≈ \$12\.40 USD/i);
    expect(displayText2).toBeInTheDocument();
  });
});

// ── Rules of Hooks regression (issue #596 fix) ───────────────────────────────
// Hooks were previously called after a conditional early return, violating the
// Rules of Hooks. This caused intermittent glitches (incorrect border colour,
// stale state) when the component transitioned between valid and invalid props.
describe('TransactionAmountDisplay - Rules of Hooks regression', () => {
  afterEach(cleanup);

  it('does not crash when switching from invalid to valid props', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(<TransactionAmountDisplay amount={0} />);
    expect(screen.getByText(/Amount must be positive/i)).toBeDefined();

    // Switching to valid props must not throw a hook-order error
    expect(() => {
      rerender(<TransactionAmountDisplay amount={100} asset="XLM" />);
    }).not.toThrow();

    expect(screen.getByText(/100 XLM ≈ \$12\.40 USD/i)).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('does not crash when switching from valid to invalid props', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(<TransactionAmountDisplay amount={100} asset="XLM" />);
    expect(screen.getByText(/100 XLM ≈ \$12\.40 USD/i)).toBeDefined();

    expect(() => {
      rerender(<TransactionAmountDisplay amount={null as unknown as number} />);
    }).not.toThrow();

    consoleSpy.mockRestore();
  });

  it('attaches containerRef to the DOM element so scrollIntoView is called', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<TransactionAmountDisplay amount={100} asset="XLM" />);

    // The ref must be attached to the rendered div, so scrollIntoView fires
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('renders multiple valid/invalid cycles without hook-order errors', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(<TransactionAmountDisplay amount={100} asset="XLM" />);

    for (let i = 0; i < 3; i++) {
      rerender(<TransactionAmountDisplay amount={-1} />);
      rerender(<TransactionAmountDisplay amount={50 + i} asset="XLM" />);
    }

    // If no hook-order error, console.error is only called for invalid props
    const hookErrors = consoleSpy.mock.calls.filter((args) =>
      String(args[0]).toLowerCase().includes('hook')
    );
    expect(hookErrors).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});
