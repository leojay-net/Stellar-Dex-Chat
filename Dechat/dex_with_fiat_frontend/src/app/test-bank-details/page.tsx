'use client';

import { useState } from 'react';
import BankDetailsModal from '@/components/BankDetailsModal';

export default function TestBankDetailsPage() {
  const [open, setOpen] = useState(true);

  return (
    <BankDetailsModal
      isOpen={open}
      onClose={() => setOpen(false)}
      xlmAmount={100}
    />
  );
}
