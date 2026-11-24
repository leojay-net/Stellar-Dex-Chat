import { z } from 'zod';
import { SUPPORTED_CURRENCIES, type CryptoPrice } from '@/lib/priceTypes';

const TOKEN_IDS = {
  XLM: 'stellar',
  ETH: 'ethereum',
  BTC: 'bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
};

const priceUrl = new URL('https://api.coingecko.com/api/v3/simple/price');
priceUrl.search = new URLSearchParams({
  ids: Object.values(TOKEN_IDS).join(','),
  vs_currencies: SUPPORTED_CURRENCIES.join(','),
  include_24hr_change: 'true',
}).toString();

const priceResponse = z.record(
  z.string(),
  z.record(z.string(), z.number().nullable()),
);
const CACHE_TTL_MS = 60_000;
const RETRY_DELAY_MS = 15_000;
const responseHeaders = { 'Cache-Control': 'no-store' };

let cached: { prices: CryptoPrice; expiresAt: number } | undefined;
let retryAt = 0;
let inFlight: Promise<void> | undefined;

async function refreshPrices() {
  try {
    const response = await fetch(priceUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);

    const data = priceResponse.parse(await response.json());
    const prices: CryptoPrice = {};
    for (const [symbol, id] of Object.entries(TOKEN_IDS)) {
      const token = data[id];
      if (!token) continue;
      const quotes: Record<string, number> = {};
      for (const currency of SUPPORTED_CURRENCIES) {
        const value = token[currency];
        if (value == null) continue;
        quotes[currency] = value;
        const change = token[`${currency}_24h_change`];
        if (change != null) quotes[`${currency}_24h_change`] = change;
      }
      if (Object.keys(quotes).length > 0) prices[symbol] = quotes;
    }
    if (Object.keys(prices).length === 0) {
      throw new Error('CoinGecko returned no supported prices');
    }

    cached = { prices, expiresAt: Date.now() + CACHE_TTL_MS };
    retryAt = 0;
  } catch (error) {
    retryAt = Date.now() + RETRY_DELAY_MS;
    console.error('Could not refresh crypto prices:', error);
  }
}

export async function GET() {
  const now = Date.now();
  const wasFresh = cached !== undefined && now < cached.expiresAt;

  if (!wasFresh && now >= retryAt) {
    inFlight ??= refreshPrices().finally(() => {
      inFlight = undefined;
    });
    await inFlight;
  }

  if (!cached) {
    return Response.json(
      { error: 'Prices are temporarily unavailable' },
      { status: 503, headers: responseHeaders },
    );
  }

  const stale = Date.now() >= cached.expiresAt;
  return Response.json(
    {
      prices: cached.prices,
      stale,
      source: stale || wasFresh ? 'cache' : 'live',
    },
    { headers: responseHeaders },
  );
}
