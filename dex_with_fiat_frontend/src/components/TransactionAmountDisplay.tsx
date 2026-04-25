'use client';

import { useEffect, useRef } from 'react';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import { transactionAmountSchema, type TransactionAmountProps } from '@/lib/transactionSchema';

/**
 * Component to display transaction amounts with live currency conversion.
 * Shows format: "100 XLM ≈ $12.40 USD"
 * Falls back to just amount if price is unavailable.
 *
 * Auto-scroll behaviour (issue #522): whenever the displayed amount changes,
 * the component scrolls itself into view so the user always sees the latest
 * value without manual scrolling.
 */
export function TransactionAmountDisplay(props: TransactionAmountProps) {
  const result = transactionAmountSchema.safeParse(props);

  if (!result.success) {
    const errorMessage = result.error.issues[0]?.message || 'Invalid Amount Data';
    console.error('TransactionAmountDisplay: Invalid props', result.error.format());
    return <span className="text-red-500 text-xs italic">{errorMessage}</span>;
  }

  const { amount, asset, fiatAmount, fiatCurrency } = result.data;

  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const normalizedAsset = asset || 'XLM';
  const { displayText } = useCurrencyConversion(numericAmount, normalizedAsset);

  // Auto-scroll: keep the latest amount visible whenever displayText updates.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [displayText]);

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
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
