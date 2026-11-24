'use client';

import { useState } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';

export default function TestBottomSheetPage() {
  const [open, setOpen] = useState(false);

  return (
    <main className="min-h-screen p-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open bottom sheet"
      >
        Open Sheet
      </button>
      <BottomSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Wallet Actions"
        ariaLabel="Wallet actions sheet"
      >
        <p>Bottom sheet content for E2E tests.</p>
      </BottomSheet>
    </main>
  );
}
