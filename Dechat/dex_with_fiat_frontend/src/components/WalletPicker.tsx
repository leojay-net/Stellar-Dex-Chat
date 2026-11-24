'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Check, Wallet } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import { WalletInfo } from '@/lib/wallets/types';

interface WalletPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WalletPicker({ isOpen, onClose }: WalletPickerProps) {
  const { isDarkMode } = useTheme();
  const { availableWallets, selectedWalletId, selectWallet, connection } = useStellarWallet();
  const [selectedId, setSelectedId] = useState<string | null>(selectedWalletId);
  const panelRef = useRef<HTMLDivElement>(null);

  useAccessibleModal(isOpen, panelRef, onClose);

  useEffect(() => {
    setSelectedId(selectedWalletId);
  }, [selectedWalletId]);

  if (!isOpen) return null;

  const handleSelect = async (walletId: string) => {
    setSelectedId(walletId);
    await selectWallet(walletId);
    onClose();
  };

  const installedWallets = availableWallets.filter((w) => w.isInstalled);
  const notInstalledWallets = availableWallets.filter((w) => !w.isInstalled);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select wallet"
        tabIndex={-1}
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none`}
      >
        <div
          className={`w-full max-w-md rounded-xl shadow-2xl ${
            isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
          }`}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-5 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-blue-500" />
              <h2 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Select Wallet
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close wallet picker"
              className={`p-1.5 rounded-lg transition-colors ${
                isDarkMode
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 space-y-4">
            {connection.isConnected && connection.walletName && (
              <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Currently connected with:
                </p>
                <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {connection.walletName}
                </p>
              </div>
            )}

            {/* Installed wallets */}
            {installedWallets.length > 0 && (
              <div className="space-y-2">
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Installed Wallets
                </h3>
                {installedWallets.map((wallet) => (
                  <button
                    key={wallet.id}
                    onClick={() => handleSelect(wallet.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                      selectedId === wallet.id
                        ? isDarkMode
                          ? 'bg-blue-900/40 border-blue-500/60'
                          : 'bg-blue-50 border-blue-300'
                        : isDarkMode
                          ? 'bg-gray-700/50 border-gray-600 hover:border-gray-500'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{wallet.icon}</span>
                      <div className="text-left">
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {wallet.name}
                        </p>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {wallet.id === selectedWalletId ? 'Currently selected' : 'Click to select'}
                        </p>
                      </div>
                    </div>
                    {selectedId === wallet.id && (
                      <Check className={`w-5 h-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Not installed wallets */}
            {notInstalledWallets.length > 0 && (
              <div className="space-y-2">
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Available Wallets
                </h3>
                {notInstalledWallets.map((wallet) => (
                  <div
                    key={wallet.id}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border opacity-50 ${
                      isDarkMode ? 'bg-gray-700/30 border-gray-700' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{wallet.icon}</span>
                      <div className="text-left">
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {wallet.name}
                        </p>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          Not installed
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No wallets message */}
            {availableWallets.length === 0 && (
              <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <Wallet className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No wallets detected. Please install a Stellar wallet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
