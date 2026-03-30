import React from 'react';
import {
  X,
  Receipt,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Download,
} from 'lucide-react';
import { TransactionHistoryEntry } from '@/types';
import { useTranslation } from '@/contexts/TranslationContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTransactionFilters } from '@/hooks/useTransactionFilters';
import { FilterChipBar } from './filters/FilterChipBar';
import CopyButton from '@/components/ui/CopyButton';
import { TransactionAmountDisplay } from './TransactionAmountDisplay';

interface ReceiptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: TransactionHistoryEntry[];
  onClearHistory?: () => void;
}

export default function ReceiptDrawer({
  isOpen,
  onClose,
  transactions,
  onClearHistory,
}: ReceiptDrawerProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();

  // Use transaction filters hook
  const {
    filterState,
    filteredTransactions,
    filterStats,
    toggleFilter,
    clearAllFilters,
  } = useTransactionFilters(transactions);

  // Determine which transactions to display
  const displayTransactions = filteredTransactions;

  // CSV export function
  const exportToCSV = (transaction: TransactionHistoryEntry) => {
    const idPrefix = transaction.id.substring(0, 8);
    const fileName = `receipt-${idPrefix}.csv`;

    // CSV headers and data
    const headers = [
      'Receipt ID (hex)',
      'Receipt ID',
      'Type',
      'Status',
      'Amount',
      'Asset',
      'Fiat Amount',
      'Fiat Currency',
      'Reference',
      'Tx Hash',
      'Note',
      'Created At',
    ];
    const row = [
      transaction.id,
      transaction.kind || 'N/A',
      transaction.status || 'N/A',
      transaction.amount || 'N/A',
      transaction.asset || 'N/A',
      transaction.fiatAmount || 'N/A',
      transaction.fiatCurrency || 'N/A',
      transaction.reference || 'N/A',
      transaction.txHash || 'N/A',
      transaction.note || 'N/A',
      transaction.createdAt
        ? new Date(transaction.createdAt).toISOString()
        : 'N/A',
    ];

    // Escape CSV values
    const escapeCsvValue = (value: string) => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const csvContent = [
      headers.join(','),
      row.map((v) => escapeCsvValue(String(v))).join(','),
    ].join('\n');

    // Create and download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity z-[100] ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-[101] transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold dark:text-white">
                {t('receipt.title')}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {transactions.length > 0 && onClearHistory && (
                <button
                  onClick={onClearHistory}
                  className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                  title="Clear history"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Filter Chips */}
          <FilterChipBar
            filterState={filterState}
            filterStats={filterStats}
            onFilterChange={toggleFilter}
            onClearAll={clearAllFilters}
          />

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {displayTransactions.length === 0 ? (
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
                  className={`p-4 rounded-xl border transition-all hover:shadow-md ${
                    isDarkMode
                      ? 'bg-gray-800 border-gray-700 hover:border-gray-600'
                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      {tx.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : tx.status === 'failed' ? (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-500 animate-pulse" />
                      )}
                      <span className="text-sm font-semibold capitalize dark:text-gray-200">
                        {tx.kind}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          tx.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                            : tx.status === 'failed'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
                        }`}
                      >
                        {tx.status}
                      </span>
                      <button
                        onClick={() => exportToCSV(tx)}
                        className="p-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                        title="Download CSV"
                        aria-label={`Download CSV for receipt ${tx.id.substring(0, 8)}`}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        {t('receipt.amount')}
                      </span>
                      <TransactionAmountDisplay
                        amount={tx.amount}
                        asset={tx.asset}
                        fiatAmount={tx.fiatAmount}
                        fiatCurrency={tx.fiatCurrency}
                      />
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
                        <span className="text-gray-500">{t('receipt.hash')}</span>
                        <div className="flex items-center gap-1">
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-500 hover:underline font-mono text-[10px]"
                          >
                            {tx.txHash.substring(0, 8)}...
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <CopyButton value={tx.txHash} iconClassName="w-3 h-3" />
                        </div>
                      </div>
                    )}
                    {tx.reference && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-gray-500">Reference</span>
                        <span className="flex items-center gap-1 font-mono text-[10px] dark:text-gray-300">
                          {tx.reference}
                          <CopyButton value={tx.reference} iconClassName="w-3 h-3" />
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] text-gray-500 pt-2 border-t dark:border-gray-700">
                      <span className="flex items-center gap-1">
                        <span>{tx.id}</span>
                        <CopyButton value={tx.id} iconClassName="w-3 h-3" />
                      </span>
                      <span>{new Date(tx.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-[10px] text-gray-500 text-center uppercase tracking-widest font-medium">
              Stellar DexFiat Verified Receipt
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
