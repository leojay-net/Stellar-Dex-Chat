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
export function TransactionAmountDisplay(props: TransactionAmountProps) {
  const result = transactionAmountSchema.safeParse(props);

  if (!result.success) {
    const errorMessage = result.error.issues[0]?.message || 'Invalid Amount Data';
    console.error('TransactionAmountDisplay: Invalid props', result.error.format());
    return (
      <motion.span
        className="text-red-500 text-xs italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {errorMessage}
      </motion.span>
    );
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
    <motion.div
      className="flex flex-col gap-1"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <motion.span
        className="font-medium dark:text-gray-300"
        key={displayText}
        initial={{ scale: 0.95, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {displayText}
      </motion.span>
      {fiatAmount && fiatCurrency && (
        <motion.span
          className="text-xs text-gray-500 dark:text-gray-400"
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
