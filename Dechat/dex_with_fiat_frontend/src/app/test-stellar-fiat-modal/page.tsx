'use client';

import { useEffect, useState } from 'react';
import StellarFiatModal from '@/components/StellarFiatModal';
import { useStellarWallet } from '@/contexts/StellarWalletContext';

const MOCK_ADDRESS =
  'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW';

export default function TestStellarFiatModalPage() {
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const { mockConnect } = useStellarWallet();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsAdminMode(params.get('mode') === 'withdraw');
    if (params.get('connected') !== 'false') {
      mockConnect(MOCK_ADDRESS);
    }
  }, [mockConnect]);

  return (
    <StellarFiatModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      isAdminMode={isAdminMode}
      defaultAmount=""
    />
  );
}
