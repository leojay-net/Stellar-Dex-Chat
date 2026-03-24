// Crypto price service for real-time price data
// Using CoinGecko free API for demonstration

export interface CryptoPrice {
  [key: string]: {
    [currency: string]: number;
  };
}

export interface TokenPriceData {
  tokenSymbol: string;
  prices: {
    [currency: string]: number;
  };
  lastUpdated: number;
}

// Token ID mapping for CoinGecko API
const TOKEN_IDS: Record<string, string> = {
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  XLM: 'stellar',
};

// Supported fiat currencies
const SUPPORTED_CURRENCIES = ['usd', 'eur', 'gbp', 'ngn', 'cad', 'aud', 'jpy'];

// Cache for prices to avoid excessive API calls
const priceCache: Map<string, TokenPriceData> = new Map();
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

/**
 * Fetch real-time crypto prices from CoinGecko API
 */
export async function fetchCryptoPrices(
  tokenSymbols: string[],
  vsCurrencies: string[] = ['usd', 'eur', 'gbp', 'ngn'],
): Promise<CryptoPrice> {
  try {
    // Map symbols to CoinGecko IDs
    const tokenIds = tokenSymbols
      .map((symbol) => TOKEN_IDS[symbol.toUpperCase()])
      .filter(Boolean);

    if (tokenIds.length === 0) {
      throw new Error('No valid token IDs found');
    }

    // Filter supported currencies
    const validCurrencies = vsCurrencies.filter((currency) =>
      SUPPORTED_CURRENCIES.includes(currency.toLowerCase()),
    );

    const idsParam = tokenIds.join(',');
    const currenciesParam = validCurrencies.join(',');

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=${currenciesParam}&include_24hr_change=false`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `CoinGecko API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    // Convert back to token symbols
    const priceData: CryptoPrice = {};
    Object.entries(data).forEach(([coinId, prices]) => {
      const tokenSymbol = Object.entries(TOKEN_IDS).find(
        ([, id]) => id === coinId,
      )?.[0];
      if (tokenSymbol) {
        priceData[tokenSymbol] = prices as { [currency: string]: number };
      }
    });

    return priceData;
  } catch (error) {
    console.error('Error fetching crypto prices:', error);

    // Fallback to cached data or default values
    return getFallbackPrices(tokenSymbols, vsCurrencies);
  }
}

/**
 * Get fallback prices when API is unavailable
 */
function getFallbackPrices(
  tokenSymbols: string[],
  vsCurrencies: string[],
): CryptoPrice {
  const fallbackPrices: CryptoPrice = {
    ETH: { usd: 4000, eur: 3700, gbp: 3200, ngn: 6500000 },
    STRK: { usd: 0.8, eur: 0.74, gbp: 0.64, ngn: 1300 },
    USDC: { usd: 1, eur: 0.92, gbp: 0.8, ngn: 1650 },
    USDT: { usd: 1, eur: 0.92, gbp: 0.8, ngn: 1650 },
    XLM: { usd: 0.12, eur: 0.11, gbp: 0.095, ngn: 200 },
  };

  const result: CryptoPrice = {};
  tokenSymbols.forEach((symbol) => {
    const symbolUpper = symbol.toUpperCase();
    if (fallbackPrices[symbolUpper]) {
      result[symbolUpper] = {};
      vsCurrencies.forEach((currency) => {
        const currencyLower = currency.toLowerCase();
        if (fallbackPrices[symbolUpper][currencyLower]) {
          result[symbolUpper][currencyLower] =
            fallbackPrices[symbolUpper][currencyLower];
        }
      });
    }
  });

  return result;
}

/**
 * Get cached price or fetch from API
 */
export async function getTokenPrice(
  tokenSymbol: string,
  vsCurrency: string = 'usd',
): Promise<number> {
  const cacheKey = `${tokenSymbol.toUpperCase()}_${vsCurrency.toLowerCase()}`;
  const cached = priceCache.get(cacheKey);

  // Return cached data if it's still fresh
  if (cached && Date.now() - cached.lastUpdated < CACHE_DURATION) {
    return cached.prices[vsCurrency.toLowerCase()] || 0;
  }

  try {
    // Fetch fresh data
    const priceData = await fetchCryptoPrices([tokenSymbol], [vsCurrency]);
    const price =
      priceData[tokenSymbol.toUpperCase()]?.[vsCurrency.toLowerCase()] || 0;

    // Update cache
    priceCache.set(cacheKey, {
      tokenSymbol: tokenSymbol.toUpperCase(),
      prices: { [vsCurrency.toLowerCase()]: price },
      lastUpdated: Date.now(),
    });

    return price;
  } catch (error) {
    console.error(`Error getting price for ${tokenSymbol}:`, error);

    // Return cached data even if stale, or 0 as last resort
    return cached?.prices[vsCurrency.toLowerCase()] || 0;
  }
}

/**
 * Convert crypto amount to fiat value
 */
export async function convertCryptoToFiat(
  tokenSymbol: string,
  amount: number,
  fiatCurrency: string = 'USD',
): Promise<number> {
  try {
    const price = await getTokenPrice(tokenSymbol, fiatCurrency);
    return amount * price;
  } catch (error) {
    console.error('Error converting crypto to fiat:', error);
    throw new Error(`Failed to convert ${tokenSymbol} to ${fiatCurrency}`);
  }
}

/**
 * Convert fiat amount to crypto value
 */
export async function convertFiatToCrypto(
  fiatAmount: number,
  tokenSymbol: string,
  fiatCurrency: string = 'USD',
): Promise<number> {
  try {
    const price = await getTokenPrice(tokenSymbol, fiatCurrency);
    if (price === 0) {
      throw new Error(`No price data available for ${tokenSymbol}`);
    }
    return fiatAmount / price;
  } catch (error) {
    console.error('Error converting fiat to crypto:', error);
    throw new Error(`Failed to convert ${fiatCurrency} to ${tokenSymbol}`);
  }
}

/**
 * Get multiple token prices at once
 */
export async function getMultipleTokenPrices(
  tokenSymbols: string[],
  vsCurrencies: string[] = ['usd'],
): Promise<CryptoPrice> {
  try {
    return await fetchCryptoPrices(tokenSymbols, vsCurrencies);
  } catch (error) {
    console.error('Error getting multiple token prices:', error);
    return getFallbackPrices(tokenSymbols, vsCurrencies);
  }
}

/**
 * Clear price cache (useful for forced refresh)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}
