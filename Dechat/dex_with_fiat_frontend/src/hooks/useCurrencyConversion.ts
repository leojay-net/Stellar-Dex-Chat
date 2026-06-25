'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchCryptoPrices } from '@/lib/cryptoPriceService';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';

export interface ConversionResult {
  originalAmount: number;
  originalCurrency: string;
  fiatAmount: number | null;
  fiatCurrency: string;
  displayText: string;
  isLoading: boolean;
  hasError: boolean;
  forceRefresh: () => Promise<void>;
}

const RATE_CACHE_TTL_MS = 60 * 1000;
const rateCache = new Map<string, { price: number; expiresAt: number }>();

function getRateCacheKey(tokenSymbol: string, fiatCurrency: string): string {
  return `${tokenSymbol.toUpperCase()}_${fiatCurrency.toLowerCase()}`;
}

/**
 * Hook to convert crypto amounts to fiat currency
 * @param amount - The amount in crypto (e.g., 100 XLM)
 * @param tokenSymbol - The token symbol (e.g., 'XLM', 'USDC')
 * @returns ConversionResult with fiat amount and display text
 */
export function useCurrencyConversion(
  amount: number | null | undefined,
  tokenSymbol: string = 'XLM',
): ConversionResult {
  const { fiatCurrency } = useUserPreferences();
  const [fiatAmount, setFiatAmount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const getCurrencySymbolForCode = useCallback((code: string): string => {
    const symbolMap: Record<string, string> = {
      usd: '$',
      eur: '€',
      gbp: '£',
      ngn: '₦',
      cad: 'CA$',
      aud: 'A$',
      jpy: '¥',
    };
    return symbolMap[code.toLowerCase()] || '';
  }, []);

  const convertAmount = useCallback(async (forceRefresh = false) => {
    if (!amount || amount <= 0 || !tokenSymbol) {
      setFiatAmount(null);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    try {
      const cacheKey = getRateCacheKey(tokenSymbol, fiatCurrency);
      const cachedRate = rateCache.get(cacheKey);
      const now = Date.now();
      let price: number | undefined;

      if (!forceRefresh && cachedRate && cachedRate.expiresAt > now) {
        price = cachedRate.price;
      } else {
        const prices = await fetchCryptoPrices([tokenSymbol], [fiatCurrency]);
        price = prices?.[tokenSymbol.toUpperCase()]?.[fiatCurrency.toLowerCase()];

        if (typeof price === 'number') {
          rateCache.set(cacheKey, {
            price,
            expiresAt: now + RATE_CACHE_TTL_MS,
          });
        }
      }

      if (typeof price === 'number') {
        const converted = amount * price;
        setFiatAmount(converted);
        setHasError(false);
      } else {
        setFiatAmount(null);
        setHasError(true);
      }
    } catch (error) {
      console.error('Currency conversion error:', error);
      setFiatAmount(null);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [amount, tokenSymbol, fiatCurrency]);

  useEffect(() => {
    convertAmount();
  }, [convertAmount]);

  const forceRefresh = useCallback(() => convertAmount(true), [convertAmount]);

  // Format display text
  const displayText = useCallback((): string => {
    if (!amount) return '';

    if (isLoading) {
      return `${amount} ${tokenSymbol} ≈ ...`;
    }

    if (hasError || fiatAmount === null) {
      // Show only crypto amount without fiat equivalent
      return `${amount} ${tokenSymbol}`;
    }

    const symbol = getCurrencySymbolForCode(fiatCurrency);
    const formattedFiat = fiatAmount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return `${amount} ${tokenSymbol} ≈ ${symbol}${formattedFiat} ${fiatCurrency.toUpperCase()}`;
  }, [amount, tokenSymbol, fiatCurrency, fiatAmount, isLoading, hasError, getCurrencySymbolForCode]);

  return {
    originalAmount: amount || 0,
    originalCurrency: tokenSymbol,
    fiatAmount,
    fiatCurrency,
    displayText: displayText(),
    isLoading,
    hasError,
    forceRefresh,
  };
}
