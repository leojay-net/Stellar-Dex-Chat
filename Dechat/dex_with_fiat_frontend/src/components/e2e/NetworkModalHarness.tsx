'use client';

import { useState } from 'react';
import NetworkStatusModal from '@/components/NetworkStatusModal';
import { StellarWalletContext } from '@/contexts/StellarWalletContext';
import { ThemeContext } from '@/contexts/ThemeContext';

type Variant = 'connected' | 'mismatch' | 'disconnected';

interface NetworkState {
  connection?: { isConnected: boolean; address: string; network: string };
  isNetworkMismatch?: boolean;
  isDarkMode?: boolean;
}

/**
 * E2E harness for NetworkStatusModal. The spec seeds `window.__NETWORK_STATE`
 * via addInitScript; when absent, falls back to the variant's defaults.
 */
export default function NetworkModalHarness({
  variant,
  dark = false,
}: {
  variant: Variant;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const seeded: NetworkState =
    (typeof window !== 'undefined' &&
      (window as unknown as { __NETWORK_STATE?: NetworkState })
        .__NETWORK_STATE) ||
    {};

  const connection = seeded.connection ?? {
    isConnected: variant !== 'disconnected',
    address:
      variant === 'disconnected'
        ? ''
        : 'GBEFLW6RT4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7NQ',
    network: variant === 'mismatch' ? 'PUBLIC' : 'TESTNET',
  };
  const isNetworkMismatch = seeded.isNetworkMismatch ?? variant === 'mismatch';
  const isDarkMode = seeded.isDarkMode ?? dark;

  const wallet = {
    connection: {
      ...connection,
      publicKey: connection.address,
      networkPassphrase: '',
    },
    isNetworkMismatch,
  } as unknown as React.ContextType<typeof StellarWalletContext>;

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode: () => {} }}>
      <StellarWalletContext.Provider value={wallet}>
        <main
          className={`min-h-screen p-6 ${isDarkMode ? 'dark bg-gray-950' : ''}`}
        >
          <NetworkStatusModal isOpen={open} onClose={() => setOpen(false)} />
        </main>
      </StellarWalletContext.Provider>
    </ThemeContext.Provider>
  );
}
