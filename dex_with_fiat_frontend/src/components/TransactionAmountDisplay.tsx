'use client';

import { useEffect, useRef } from 'react';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import { transactionAmountSchema, type TransactionAmountProps } from '@/lib/transactionSchema';
import { motion } from 'framer-motion';

/**
 * Component to display transaction amounts with live currency conversion.
 * Shows format: "100 XLM ≈ $12.40 USD"
 * Falls back to just amount if price is unavailable.
 *
 * Auto-scroll behaviour (issue #522): whenever the displayed amount changes,
 * the component scrolls itself into view so the user always sees the latest
 * value without manual scrolling.
 */
export function TransactionAmountDisplay({
  amount,
  asset,
  fiatAmount,
  fiatCurrency,
}: TransactionAmountDisplayProps) {
  const numericAmount =
    typeof amount === 'string' ? parseFloat(amount) : amount;
  const normalizedAsset = asset || 'XLM';
  const { displayText } = useCurrencyConversion(numericAmount, normalizedAsset);

  // Auto-scroll: keep the latest amount visible whenever displayText updates.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [displayText]);

  if (!result.success) {
    const errorMessage = result.error.issues[0]?.message || 'Invalid Amount Data';
    console.error('TransactionAmountDisplay: Invalid props', result.error.format());
    return (
      <motion.span
        className="theme-soft-danger inline-flex items-center rounded-md border px-2 py-1 text-xs italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {errorMessage}
      </motion.span>
    );
  }

  const { fiatAmount, fiatCurrency } = result.data;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium dark:text-gray-300">{displayText}</span>
      {fiatAmount && fiatCurrency && (
        <motion.span
          className="text-xs theme-text-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: 0.1 }}
        >
          Stored fiat: {fiatAmount} {fiatCurrency}
        </motion.span>
      )}
    </motion.div>
  );
}
