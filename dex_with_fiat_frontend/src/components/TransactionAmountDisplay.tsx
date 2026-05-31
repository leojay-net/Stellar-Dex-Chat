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

  // Derive values for hooks unconditionally — hooks must not be called after
  // a conditional return (Rules of Hooks). Fall back to neutral values when
  // the parse fails so useCurrencyConversion still receives valid arguments.
  const parsed = result.success ? result.data : null;
  const numericAmount = parsed
    ? (typeof parsed.amount === 'string' ? parseFloat(parsed.amount) : parsed.amount)
    : 0;
  const normalizedAsset = parsed?.asset || 'XLM';

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
    <motion.div
      ref={containerRef}
      className="flex flex-col gap-1"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <motion.span
        className="font-medium theme-text-primary"
        key={displayText}
        initial={{ scale: 0.95, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {displayText}
      </motion.span>
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
