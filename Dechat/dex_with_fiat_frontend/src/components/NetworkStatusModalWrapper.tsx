'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

const NetworkStatusModal = dynamic(() => import('./NetworkStatusModal'), {
  ssr: false,
});

interface NetworkStatusModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NetworkStatusModalWrapper(
  props: NetworkStatusModalWrapperProps,
) {
  return (
    <Suspense fallback={null}>
      <NetworkStatusModal {...props} />
    </Suspense>
  );
}
