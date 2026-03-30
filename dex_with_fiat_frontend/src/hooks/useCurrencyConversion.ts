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

  const convertAmount = useCallback(async () => {
    if (!amount || amount <= 0 || !tokenSymbol) {
      setFiatAmount(null);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    try {
      const prices = await fetchCryptoPrices([tokenSymbol], [fiatCurrency]);

      if (prices && prices[tokenSymbol] && prices[tokenSymbol][fiatCurrency]) {
        const price = prices[tokenSymbol][fiatCurrency];
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
  };
}
