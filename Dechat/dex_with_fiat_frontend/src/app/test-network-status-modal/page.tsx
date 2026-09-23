'use client';

import { useEffect, useState } from 'react';
import NetworkStatusModal from '@/components/NetworkStatusModal';
import { useStellarWallet } from '@/contexts/StellarWalletContext';

const DEFAULT_ADDRESS =
  'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW';

/**
 * Test harness page for NetworkStatusModal E2E tests.
 *
 * Query params select the wallet state the modal renders:
 *   - `state=connected` (default): mock wallet connected to TESTNET
 *   - `state=mismatch`: mock wallet connected to PUBLIC (network mismatch)
 *   - `state=disconnected`: no wallet connected
 *   - `address=<G...>`: wallet address to connect with (optional)
 *
 * Dark/light mode comes from the real ThemeProvider, so tests set the `theme`
 * localStorage key before navigation.
 */
export default function TestNetworkStatusModalPage() {
  const { mockConnect } = useStellarWallet();
  const [isOpen, setIsOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') ?? 'connected';
    const address = params.get('address') || DEFAULT_ADDRESS;

    if (state === 'connected') {
      mockConnect(address);
    } else if (state === 'mismatch') {
      mockConnect(address, 'PUBLIC');
    }
    setReady(true);
  }, [mockConnect]);

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">NetworkStatusModal Test Harness</h1>
      <div>
        <button
          type="button"
          data-testid="open-network-status"
          onClick={() => setIsOpen(true)}
          className="px-3 py-1 text-sm rounded border"
        >
          Open network status
        </button>
      </div>
      {ready && (
        <NetworkStatusModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
      )}
    </main>
  );
}
