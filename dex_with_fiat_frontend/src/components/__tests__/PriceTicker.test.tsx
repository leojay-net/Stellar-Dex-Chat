import React from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from '@testing-library/react';
import PriceTicker from '@/components/PriceTicker';

const fetchTickerDataMock = vi.fn();

vi.mock('@/lib/cryptoPriceService', () => ({
  fetchTickerData: (...args: unknown[]) => fetchTickerDataMock(...args),
}));

function mockPrices(symbols: string[]) {
  const out: Record<
    string,
    { symbol: string; price: number; change24h: number; currency: string }
  > = {};
  for (const s of symbols) {
    out[s] = { symbol: s, price: 1, change24h: 0.5, currency: 'usd' };
  }
  return out;
}

function mockPrice(symbol: string, price: number) {
  return {
    [symbol]: {
      symbol,
      price,
      change24h: 0.5,
      currency: 'usd',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('PriceTicker – keyboard shortcuts', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    fetchTickerDataMock.mockImplementation(async (symbols: string[]) =>
      mockPrices(symbols),
    );
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

  it('does not refetch repeatedly when using the default symbols', async () => {
    render(<PriceTicker refreshInterval={600_000} />);

    await waitFor(() => {
      expect(screen.getByText('XLM')).toBeDefined();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchTickerDataMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest refresh result when an older request resolves last', async () => {
    const slowRefresh = deferred<ReturnType<typeof mockPrice>>();
    const fastRefresh = deferred<ReturnType<typeof mockPrice>>();

    fetchTickerDataMock
      .mockResolvedValueOnce(mockPrice('XLM', 1))
      .mockReturnValueOnce(slowRefresh.promise)
      .mockReturnValueOnce(fastRefresh.promise);

    render(<PriceTicker symbols={['XLM']} refreshInterval={600_000} />);

    await waitFor(() => {
      expect(screen.getByText('$1.00')).toBeDefined();
    });

    const ticker = screen.getByTestId('price-ticker');
    ticker.focus();
    fireEvent.keyDown(ticker, { key: 'r' });
    fireEvent.keyDown(ticker, { key: 'r' });

    await act(async () => {
      fastRefresh.resolve(mockPrice('XLM', 3));
      await fastRefresh.promise;
    });

    expect(screen.getByText('$3.00')).toBeDefined();

    await act(async () => {
      slowRefresh.resolve(mockPrice('XLM', 2));
      await slowRefresh.promise;
    });

    expect(screen.getByText('$3.00')).toBeDefined();
    expect(screen.queryByText('$2.00')).toBeNull();
  });
});
