'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

const BankDetailsModal = dynamic(() => import('./BankDetailsModal'), {
  ssr: false,
});

interface BankDetailsModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  xlmAmount: number;
}

export default function BankDetailsModalWrapper(
  props: BankDetailsModalWrapperProps,
) {
  return (
    <Suspense fallback={null}>
      <BankDetailsModal {...props} />
    </Suspense>
  );
}
