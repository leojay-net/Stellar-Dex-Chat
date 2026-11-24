import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const quotes = { XLM: { usd: 0.12, usd_24h_change: 1.5 } };
const upstreamQuotes = {
  stellar: { usd: 0.12, usd_24h_change: 1.5, eur: null },
};

describe('GET /api/prices', () => {
  it('shares concurrent upstream requests and returns the fresh cached prices', async () => {
    mockFetch.mockResolvedValue(Response.json(upstreamQuotes));
    const { GET } = await import('./route');

    const requests = await Promise.all([GET(), GET()]);
    for (const response of requests) {
      expect(await response.json()).toEqual({
        prices: quotes,
        stale: false,
        source: 'live',
      });
    }
    const cached = await GET();
    expect(await cached.json()).toEqual({
      prices: quotes,
      stale: false,
      source: 'cache',
    });
    expect(cached.headers.get('Cache-Control')).toBe('no-store');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('serves flagged stale prices during an outage and refreshes after the retry delay', async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json(upstreamQuotes))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ stellar: { usd: 0.15 } }));
    const { GET } = await import('./route');
    await GET();

    vi.setSystemTime(60_000);
    for (const response of [await GET(), await GET()]) {
      expect(await response.json()).toEqual({
        prices: quotes,
        stale: true,
        source: 'cache',
      });
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.setSystemTime(75_000);
    expect(await (await GET()).json()).toEqual({
      prices: { XLM: { usd: 0.15 } },
      stale: false,
      source: 'live',
    });
  });

  it('returns 503 when no usable upstream data has been cached', async () => {
    mockFetch.mockResolvedValue(Response.json({}));
    const { GET } = await import('./route');

    expect((await GET()).status).toBe(503);
  });
});
