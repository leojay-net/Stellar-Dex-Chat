import React from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import PriceTicker from '@/components/PriceTicker';

const fetchTickerDataMock = vi.fn();

vi.mock('@/lib/cryptoPriceService', () => ({
  fetchTickerData: (...args: unknown[]) => fetchTickerDataMock(...args),
}));

function mockPrices(symbols: string[]) {
  const out: Record<string, { symbol: string; price: number; change24h: number; currency: string }> = {};
  for (const s of symbols) {
    out[s] = { symbol: s, price: 1, change24h: 0.5, currency: 'usd' };
  }
  return out;
}

describe('PriceTicker – keyboard shortcuts', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    fetchTickerDataMock.mockImplementation(async (symbols: string[]) => mockPrices(symbols));
  });

  it('moves to the next page with ArrowRight when focused', async () => {
    const symbols = ['A', 'B', 'C', 'D', 'E', 'F'];
    render(<PriceTicker symbols={symbols} refreshInterval={600_000} />);

    await waitFor(() => {
      expect(fetchTickerDataMock).toHaveBeenCalled();
    });

    expect(screen.getByText('A')).toBeDefined();
    const ticker = screen.getByTestId('price-ticker');
    ticker.focus();
    fireEvent.keyDown(ticker, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByText('F')).toBeDefined();
    });
  });

  it('refreshes prices when R is pressed while focused', async () => {
    const symbols = ['XLM'];
    render(<PriceTicker symbols={symbols} refreshInterval={600_000} />);

    await waitFor(() => {
      expect(fetchTickerDataMock).toHaveBeenCalledTimes(1);
    });

    const ticker = screen.getByTestId('price-ticker');
    ticker.focus();
    fireEvent.keyDown(ticker, { key: 'r' });

    await waitFor(() => {
      expect(fetchTickerDataMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
