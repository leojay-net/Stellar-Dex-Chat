export interface CryptoPrice {
  [key: string]: {
    [currency: string]: number;
  };
}

export type PriceSource = 'live' | 'cache' | 'fallback';

export interface CryptoPriceResult {
  prices: CryptoPrice;
  stale: boolean;
  source: PriceSource;
}

// Supported fiat currencies — exported so UI can reference the same list
export const SUPPORTED_CURRENCIES = [
  'usd',
  'eur',
  'gbp',
  'ngn',
  'cad',
  'aud',
  'jpy',
];
