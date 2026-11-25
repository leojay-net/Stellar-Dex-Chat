/**
 * #1807 — Assert that the CSP connect-src covers every host the client bundle
 * fetches directly. Missing an origin here causes a silent production breakage
 * (the browser blocks the request but the CI build passes).
 *
 * Strategy: import REQUIRED_CONNECT_ORIGINS from next.config.ts and assert that
 * each required origin is present. This is cheaper than parsing the full CSP
 * header string and survives reformatting.
 */

import { REQUIRED_CONNECT_ORIGINS } from '../../../next.config';

const ORIGINS_MUST_COVER: string[] = [
  // Core Stellar infrastructure
  'https://horizon.stellar.org',
  'https://horizon-testnet.stellar.org',
  'https://soroban-testnet.stellar.org',
  // Soroban RPC (mainnet + futurenet defaults)
  'https://rpc-mainnet.stellar.org',
  'https://rpc-futurenet.stellar.org',
  // CoinGecko — called from /api/prices (server) but exported origins must
  // cover client-side fallbacks too.
  'https://api.coingecko.com',
  // Cloudflare connectivity probe (useOnlineStatus)
  'https://cloudflare.com',
  'https://1.1.1.1',
  // Freighter wallet websocket
  'wss://*.freighter.app',
  // Sentry error reporting
  'https://*.sentry.io',
  // Self
  "'self'",
];

describe('CSP connect-src (#1807)', () => {
  const origins = new Set<string>(REQUIRED_CONNECT_ORIGINS);

  test.each(ORIGINS_MUST_COVER)(
    'connect-src covers %s',
    (expected) => {
      expect(origins.has(expected)).toBe(true);
    },
  );

  it('contains no duplicate entries (deduplication is correct)', () => {
    const arr = Array.from(REQUIRED_CONNECT_ORIGINS);
    const unique = new Set(arr);
    expect(arr.length).toBe(unique.size);
  });
});
