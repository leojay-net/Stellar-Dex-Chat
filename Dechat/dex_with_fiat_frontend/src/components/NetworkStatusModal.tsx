'use client';

import { X, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useStellarWallet, EXPECTED_NETWORK } from '@/contexts/StellarWalletContext';

interface NetworkStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NetworkStatusModal({ isOpen, onClose }: NetworkStatusModalProps) {
  const { isDarkMode } = useTheme();
  const { connection, isNetworkMismatch } = useStellarWallet();

  if (!isOpen) return null;

  const status = !connection.isConnected
    ? 'disconnected'
    : isNetworkMismatch
      ? 'mismatch'
      : 'connected';

  const statusConfig = {
    connected: {
      dot: 'bg-green-400',
      label: 'Connected',
      description: `Wallet is connected to the Stellar ${connection.network} network.`,
      Icon: Wifi,
      iconClass: isDarkMode ? 'text-green-400' : 'text-green-600',
    },
    mismatch: {
      dot: 'bg-amber-400',
      label: 'Network Mismatch',
      description: `Wallet is connected to ${connection.network} but the app expects ${EXPECTED_NETWORK}. Transactions are disabled.`,
      Icon: AlertTriangle,
      iconClass: isDarkMode ? 'text-amber-400' : 'text-amber-600',
    },
    disconnected: {
      dot: 'bg-red-500',
      label: 'Disconnected',
      description: 'No Stellar wallet is connected. Connect Freighter to send transactions.',
      Icon: WifiOff,
      iconClass: isDarkMode ? 'text-red-400' : 'text-red-600',
    },
  }[status];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Network status"
        className={`fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-xl shadow-2xl border p-6 transition-colors duration-300 ${
          isDarkMode
            ? 'bg-gray-900 border-gray-700 text-gray-100'
            : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Network Status</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className={`p-1.5 rounded-lg transition-colors ${
              isDarkMode
                ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-3">
          <span className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${statusConfig.dot}`} />
          <div>
            <p className="font-medium text-sm">{statusConfig.label}</p>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {statusConfig.description}
            </p>
          </div>
        </div>

        {connection.isConnected && (
          <dl className={`mt-4 space-y-2 text-xs border-t pt-4 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex justify-between">
              <dt className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Address</dt>
              <dd className="font-mono">
                {connection.address.slice(0, 6)}…{connection.address.slice(-4)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Network</dt>
              <dd>{connection.network || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Expected</dt>
              <dd>{EXPECTED_NETWORK}</dd>
            </div>
          </dl>
        )}
      </div>
    </>
  );
}
