'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Receipt,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Printer,
} from 'lucide-react';
import { TransactionHistoryEntry } from '@/types';
import { useTranslation } from '@/contexts/TranslationContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTransactionFilters } from '@/hooks/useTransactionFilters';
import { FilterChipBar } from './filters/FilterChipBar';
import SkeletonReceipt from '../components/ui/skeleton/SkeletonReceipt';
import ReceiptQrCode from './ReceiptQrCode';

interface ReceiptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: TransactionHistoryEntry[];
  onClearHistory?: () => void;
}

function getReceiptQrValue(tx: TransactionHistoryEntry): string {
  if (tx.txHash) {
    return `https://stellar.expert/explorer/testnet/tx/${tx.txHash}`;
  }
  if (tx.reference) {
    return `stellar-dex-receipt:${tx.reference}`;
  }
  return `stellar-dex-receipt:${tx.id}`;
}

/** Print styles injected into <head> once. */
const PRINT_STYLES = `
@media print {
  /* Isolate receipt drawer from the rest of the page (works when nested in Next.js layout) */
  body * {
    visibility: hidden;
  }

  #receipt-drawer-root,
  #receipt-drawer-root * {
    visibility: visible;
  }

  #receipt-drawer-root {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }

  /* Remove drawer chrome — keep receipt data prominent */
  .receipt-drawer-backdrop,
  .receipt-drawer-header-actions,
  .receipt-drawer-close-btn,
  .receipt-drawer-clear-btn,
  .receipt-drawer-print-btn,
  .receipt-drawer-filters,
  .receipt-drawer-footer,
  .receipt-drawer-skeleton,
  .receipt-print-hide {
    display: none !important;
    visibility: hidden !important;
  }

  /* Make drawer fill the page */
  .receipt-drawer-panel {
    position: static !important;
    transform: none !important;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    box-shadow: none !important;
    overflow: visible !important;
    background: #fff !important;
  }

  .receipt-drawer-panel > div {
    height: auto !important;
    overflow: visible !important;
  }

  /* Receipt content area */
  .receipt-drawer-content {
    overflow: visible !important;
    height: auto !important;
  }

  /* Receipt cards — clean bordered blocks, page-break safe */
  .receipt-card {
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px solid #cbd5e1 !important;
    background: #fff !important;
    color: #0f172a !important;
    border-radius: 8px;
    margin-bottom: 12px;
    box-shadow: none !important;
  }

  .receipt-card * {
    color: #0f172a !important;
  }

  .receipt-card .receipt-status-badge {
    border: 1px solid #cbd5e1 !important;
    background: #f8fafc !important;
  }

  /* Full tx hash on print (link title holds the complete hash) */
  .receipt-tx-hash-link {
    text-decoration: none !important;
    color: #1d4ed8 !important;
    overflow: visible !important;
    white-space: normal !important;
    word-break: break-all !important;
    font-size: 0 !important;
  }

  .receipt-tx-hash-link::after {
    content: attr(title);
    font-size: 9px;
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }

  /* Header stays at top of print page */
  .receipt-drawer-header {
    border-bottom: 2px solid #0f172a !important;
    padding-bottom: 8px;
    margin-bottom: 16px;
    background: #fff !important;
  }

  .receipt-drawer-header h2 {
    color: #0f172a !important;
  }

  /* QR code: crisp, high-contrast, no cropping */
  .receipt-qr-wrapper {
    border-top: 1px solid #cbd5e1 !important;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .receipt-qr-code {
    width: 128px !important;
    height: 128px !important;
    min-width: 128px !important;
    min-height: 128px !important;
    max-width: none !important;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .receipt-qr-label {
    color: #64748b !important;
  }

  @page {
    margin: 16mm;
    size: auto;
  }
}
`;

export default function ReceiptDrawer({
  isOpen,
  onClose,
  transactions,
  onClearHistory,
}: ReceiptDrawerProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();

  const [isLoading, setIsLoading] = useState(true);

  // Inject print styles once
  useEffect(() => {
    const id = 'receipt-print-styles';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = PRINT_STYLES;
      document.head.appendChild(style);
    }
  }, []);

  // Keyboard shortcuts: Escape closes, Backspace/Delete clears history (issue #528)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && onClearHistory) {
        onClearHistory();
      }
    },
    [isOpen, onClose, onClearHistory],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      const timer = setTimeout(() => {
        setIsLoading(false);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Use transaction filters hook
  const {
    filterState,
    filteredTransactions,
    filterStats,
    toggleFilter,
    clearAllFilters,
    getFilterChipTone,
  } = useTransactionFilters(transactions);

  const displayTransactions = filteredTransactions;

  return (
    <div id="receipt-drawer-root">
      {/* Backdrop */}
      <div
        className={`receipt-drawer-backdrop fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity z-[100] ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`receipt-drawer-panel fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-[101] transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        aria-busy={isLoading}
        role="dialog"
        aria-modal="true"
        aria-hidden={!isOpen}
        aria-label="Transaction receipts — press Escape to close"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="receipt-drawer-header flex items-center justify-between p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold dark:text-white">
                {t('receipt.title')}
              </h2>
            </div>
            <div className="receipt-drawer-header-actions flex items-center gap-2">
              {/* Print button */}
              {transactions.length > 0 && (
                <button
                  type="button"
                  onClick={handlePrint}
                  className="receipt-drawer-print-btn p-2 text-gray-500 hover:text-blue-600 transition-colors"
                  title="Print receipts (Ctrl+P)"
                  aria-label="Print transaction receipts"
                >
                  <Printer className="w-5 h-5" />
                </button>
              )}
              {transactions.length > 0 && onClearHistory && (
                <button
                  onClick={onClearHistory}
                  className="receipt-drawer-clear-btn p-2 text-gray-500 hover:text-red-500 transition-colors"
                  title="Clear history (Backspace)"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close transaction receipts"
                className="receipt-drawer-close-btn p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Filter Chips */}
          <div className="receipt-drawer-filters">
            <FilterChipBar
              filterState={filterState}
              filterStats={filterStats}
              getFilterChipTone={getFilterChipTone}
              onFilterChange={toggleFilter}
              onClearAll={clearAllFilters}
            />
          </div>

          {/* Content */}
          <div className="receipt-drawer-content flex-1 overflow-y-auto p-4 space-y-4">
            {isLoading ? (
              <div className="receipt-drawer-skeleton space-y-4">
                <SkeletonReceipt />
                <SkeletonReceipt />
                <SkeletonReceipt />
              </div>
            ) : displayTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <Receipt className="w-12 h-12 mb-4 opacity-20" />
                {transactions.length === 0 ? (
                  <p>{t('receipt.no_receipts')}</p>
                ) : (
                  <div className="text-center space-y-2">
                    <p className="font-medium">
                      No transactions match your filters
                    </p>
                    <button
                      onClick={clearAllFilters}
                      className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>
            ) : (
              displayTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className={`receipt-card p-4 rounded-xl border transition-all hover:shadow-md ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 hover:border-gray-600'
                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                    }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      {tx.status === 'completed' ? (
                        <CheckCircle2 className="receipt-print-hide w-4 h-4 text-green-500" />
                      ) : tx.status === 'failed' ? (
                        <AlertCircle className="receipt-print-hide w-4 h-4 text-red-500" />
                      ) : (
                        <Clock className="receipt-print-hide w-4 h-4 text-amber-500 animate-pulse" />
                      )}
                      <span className="text-sm font-semibold capitalize dark:text-gray-200">
                        {tx.kind}
                      </span>
                    </div>
                    <span
                      className={`receipt-status-badge text-[10px] px-2 py-0.5 rounded-full font-medium ${tx.status === 'completed'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                          : tx.status === 'failed'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
                        }`}
                    >
                      {tx.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        {t('receipt.amount')}
                      </span>
                      <span className="font-medium dark:text-gray-300">
                        {tx.amount} {tx.asset}
                      </span>
                    </div>
                    {tx.fiatAmount && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Fiat</span>
                        <span className="font-medium dark:text-gray-300">
                          {tx.fiatAmount} {tx.fiatCurrency}
                        </span>
                      </div>
                    )}
                    {tx.txHash && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-gray-500 shrink-0">
                          {t('receipt.hash')}
                        </span>
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="receipt-tx-hash-link flex items-center gap-1 text-blue-500 hover:underline font-mono text-[10px] min-w-0 truncate"
                          title={tx.txHash}
                        >
                          {tx.txHash.length > 16
                            ? `${tx.txHash.substring(0, 8)}...${tx.txHash.substring(tx.txHash.length - 6)}`
                            : tx.txHash}
                          <ExternalLink className="receipt-print-hide w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] text-gray-500 pt-2 border-t dark:border-gray-700">
                      <span className="truncate min-w-0 mr-2" title={tx.id}>{tx.id}</span>
                      <span className="shrink-0">{new Date(tx.createdAt).toLocaleString()}</span>
                    </div>
                    <ReceiptQrCode
                      value={getReceiptQrValue(tx)}
                      label={`Verify ${tx.kind} transaction`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="receipt-drawer-footer p-4 border-t dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-[10px] text-gray-500 text-center uppercase tracking-widest font-medium">
              Stellar DexFiat Verified Receipt
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
