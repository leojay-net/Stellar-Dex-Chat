'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fetchTickerData, TickerData } from '@/lib/cryptoPriceService';

interface PriceTickerProps {
  symbols?: string[];
  currency?: string;
  refreshInterval?: number;
}

export default function PriceTicker({
  symbols = ['XLM', 'ETH', 'BTC'],
  currency = 'usd',
  refreshInterval = 60000, // 60 seconds default
}: PriceTickerProps) {
  const [prices, setPrices] = useState<TickerData>({});
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Format price based on currency
  const formatPrice = (price: number) => {
    if (currency.toUpperCase() === 'JPY') {
      return `¥${price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    if (currency.toUpperCase() === 'NGN') {
      return `₦${price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    if (price < 1) {
      return `$${price.toFixed(4)}`;
    }
    if (price < 1000) {
      return `$${price.toFixed(2)}`;
    }
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format change percentage
  const formatChange = (change: number | undefined) => {
    if (change === undefined || change === null) return 'N/A%';
    const formatted = change.toFixed(2);
    return `${change >= 0 ? '+' : ''}${formatted}%`;
  };

  // Fetch prices
  const fetchPrices = useCallback(async () => {
    try {
      setError(false);
      const newPrices = await fetchTickerData(symbols, currency);
      
      if (Object.keys(newPrices).length === 0) {
        setError(true);
      } else {
        setPrices(newPrices);
      }
    } catch (err) {
      console.error('Failed to fetch ticker data:', err);
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [symbols, currency]);

  // Initial fetch and setup refresh interval
  useEffect(() => {
    fetchPrices();

    // Setup auto-refresh
    refreshTimeoutRef.current = setInterval(() => {
      fetchPrices();
    }, refreshInterval);

    return () => {
      if (refreshTimeoutRef.current) {
        clearInterval(refreshTimeoutRef.current);
      }
    };
  }, [fetchPrices, refreshInterval]);

  // Show error state
  if (isLoading && Object.keys(prices).length === 0) {
    return (
      <div className="theme-surface-muted rounded-lg border theme-border p-3 animate-pulse">
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-8 theme-background rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error && Object.keys(prices).length === 0) {
    return (
      <div className="theme-surface-muted rounded-lg border theme-border p-3">
        <p className="theme-text-secondary text-sm text-center py-2">
          Prices unavailable
        </p>
      </div>
    );
  }

  return (
    <div className="theme-surface-muted rounded-lg border theme-border p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="theme-text-primary text-xs font-semibold uppercase tracking-wider">
          Market Prices
        </h3>
        <div
          className={`w-2 h-2 rounded-full transition-colors duration-300 ${
            error ? 'bg-red-500' : 'bg-green-500'
          }`}
        />
      </div>

      <div className="space-y-2">
        {symbols.map((symbol) => {
          const priceData = prices[symbol];
          
          if (!priceData) {
            return (
              <div key={symbol} className="flex items-center justify-between text-xs h-6 opacity-50">
                <span className="theme-text-secondary font-medium">{symbol}</span>
                <span className="theme-text-secondary">--</span>
              </div>
            );
          }

          const change = priceData.change24h;
          const isPositive = change !== undefined && change >= 0;
          const isNegative = change !== undefined && change < 0;

          return (
            <div
              key={symbol}
              className="flex items-center justify-between text-xs transition-all duration-300 group"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="theme-text-primary font-semibold whitespace-nowrap">
                  {symbol}
                </span>
                <span className="theme-text-secondary truncate">
                  {formatPrice(priceData.price)}
                </span>
              </div>

              <div
                className={`flex items-center gap-0.5 whitespace-nowrap ml-2 transition-colors duration-300 ${
                  isPositive
                    ? 'text-green-500 dark:text-green-400'
                    : isNegative
                      ? 'text-red-500 dark:text-red-400'
                      : 'theme-text-secondary'
                }`}
              >
                {isPositive && <TrendingUp className="w-3 h-3" />}
                {isNegative && <TrendingDown className="w-3 h-3" />}
                <span className="font-medium">
                  {formatChange(change)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {error && Object.keys(prices).length > 0 && (
        <p className="theme-text-secondary text-[10px] mt-2 text-center opacity-60">
          Last updated • Tap to refresh
        </p>
      )}
    </div>
  );
}
