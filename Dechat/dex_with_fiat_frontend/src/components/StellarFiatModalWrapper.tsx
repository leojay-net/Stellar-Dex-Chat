'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import type { ChatMessage } from '@/types';

const StellarFiatModal = dynamic(() => import('./StellarFiatModal'), {
  ssr: false,
});

interface StellarFiatModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAmount?: string;
  fiatCurrency?: string;
  isAdminMode?: boolean;
  recipientAddress?: string;
  onDepositSuccess?: (result: { xlmAmount: number; note?: string }) => void;
  messages?: ChatMessage[];
}

export default function StellarFiatModalWrapper(
  props: StellarFiatModalWrapperProps,
) {
  return (
    <Suspense fallback={null}>
      <StellarFiatModal {...props} />
    </Suspense>
  );
}
