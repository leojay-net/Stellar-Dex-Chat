import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const {
  fetchCryptoPrices,
  getTokenPrice,
  clearPriceCache,
  fetchTickerData,
} = await import('./cryptoPriceService');

describe('cryptoPriceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPriceCache();
  });

  describe('getTokenPrice deduplication (stale closure fix)', () => {
    it('deduplicates concurrent requests for the same token+currency', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ stellar: { usd: 0.12, usd_24h_change: 1.5 } }),
      });

      // Fire 3 concurrent requests for the same key
      const [p1, p2, p3] = await Promise.all([
        getTokenPrice('XLM', 'usd'),
        getTokenPrice('XLM', 'usd'),
        getTokenPrice('XLM', 'usd'),
      ]);

      expect(p1).toBe(0.12);
      expect(p2).toBe(0.12);
      expect(p3).toBe(0.12);
      // Only one fetch should have been made, not three
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns cached value without fetching when cache is fresh', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ stellar: { usd: 0.15, usd_24h_change: 2.0 } }),
      });

      // First call fetches
      const price1 = await getTokenPrice('XLM', 'usd');
      expect(price1).toBe(0.15);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const price2 = await getTokenPrice('XLM', 'usd');
      expect(price2).toBe(0.15);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns fallback (0) when fetch fails and no cache exists', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));

      const price = await getTokenPrice('UNKNOWN', 'usd');
      expect(price).toBe(0);
    });
  });

  describe('fetchCryptoPrices', () => {
    it('returns mapped prices on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            stellar: { usd: 0.11, eur: 0.1 },
            ethereum: { usd: 4000, eur: 3700 },
          }),
      });

      const result = await fetchCryptoPrices(['XLM', 'ETH'], ['usd', 'eur']);

      expect(result).toEqual({
        XLM: { usd: 0.11, eur: 0.1 },
        ETH: { usd: 4000, eur: 3700 },
      });
    });

    it('returns fallback when API returns error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const result = await fetchCryptoPrices(['XLM'], ['usd']);
      // Should get fallback values, not throw
      expect(result.XLM).toBeDefined();
      expect(result.XLM.usd).toBe(0.11);
    });

    it('returns fallback for unknown symbols', async () => {
      const result = await fetchCryptoPrices(['FAKECOIN'], ['usd']);
      expect(result).toEqual({});
    });
  });

  describe('fetchTickerData', () => {
    it('returns empty object on error (not throw)', async () => {
      mockFetch.mockRejectedValue(new Error('API down'));

      const result = await fetchTickerData(['XLM'], 'usd');
      expect(result).toEqual({});
    });

    it('returns ticker data on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            stellar: { usd: 0.12, usd_24h_change: 3.5 },
          }),
      });

      const result = await fetchTickerData(['XLM'], 'usd');
      expect(result.XLM).toEqual({
        symbol: 'XLM',
        price: 0.12,
        change24h: 3.5,
        currency: 'usd',
      });
    });
  });
});
