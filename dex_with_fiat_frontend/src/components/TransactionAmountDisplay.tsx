'use client';

import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';

interface TransactionAmountDisplayProps {
  amount?: number | string;
  asset?: string;
  fiatAmount?: string | number;
  fiatCurrency?: string;
}

/**
 * Component to display transaction amounts with live currency conversion
 * Shows format: "100 XLM ≈ $12.40 USD"
 * Falls back to just amount if price is unavailable
 */
export function TransactionAmountDisplay({
  amount,
  asset,
  fiatAmount,
  fiatCurrency,
}: TransactionAmountDisplayProps) {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const normalizedAsset = asset || 'XLM';
  const { displayText } = useCurrencyConversion(numericAmount, normalizedAsset);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium dark:text-gray-300">
        {displayText}
      </span>
      {fiatAmount && fiatCurrency && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Stored fiat: {fiatAmount} {fiatCurrency}
        </span>
      )}
    </div>
  );
}
