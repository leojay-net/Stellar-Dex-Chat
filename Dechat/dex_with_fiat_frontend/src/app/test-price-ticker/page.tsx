'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PriceTicker from '@/components/PriceTicker';

function TestPriceTickerContent() {
  const searchParams = useSearchParams();
  const symbolsParam = searchParams.get('symbols');
  const currencyParam = searchParams.get('currency');
  const intervalParam = searchParams.get('refreshInterval');

  const symbols = symbolsParam
    ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const currency = currencyParam ?? undefined;
  const refreshInterval = intervalParam ? Number(intervalParam) : undefined;

  return (
    <main className="min-h-screen p-6 bg-[var(--background)]">
      <h1 className="text-lg font-semibold mb-4">PriceTicker Test Harness</h1>
      <div className="max-w-sm">
        <PriceTicker
          symbols={symbols}
          currency={currency}
          refreshInterval={refreshInterval}
        />
      </div>
    </main>
  );
}

export default function TestPriceTickerPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading harness…</div>}>
      <TestPriceTickerContent />
    </Suspense>
  );
}
