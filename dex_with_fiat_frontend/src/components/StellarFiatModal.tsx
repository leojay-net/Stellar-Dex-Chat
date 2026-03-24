'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowDownUp,
} from 'lucide-react';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import {
  BRIDGE_LIMIT_WARNING_PERCENT,
  depositToContract,
  getBridgeLimit,
  withdrawFromContract,
  stroopsToDisplay,
} from '@/lib/stellarContract';
import {
  getTokenPrice,
  formatFiatAmount,
} from '@/lib/cryptoPriceService';
import SkeletonPayout from '@/components/ui/skeleton/SkeletonPayout';

interface StellarFiatModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAmount?: string;
  fiatCurrency?: string;
  isAdminMode?: boolean;
  recipientAddress?: string;
  onDepositSuccess?: (xlmAmount: number) => void;
}

type TxStatus = 'idle' | 'loading' | 'success' | 'error';

function parseAmountToStroops(value: string): bigint | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (!/^\d*(?:\.\d{0,7})?$/.test(normalized)) {
    return null;
  }

  const [wholePart = '0', fractionalPart = ''] = normalized.split('.');

  if (!wholePart && !fractionalPart) {
    return null;
  }

  const whole = wholePart || '0';
  const fraction = (fractionalPart || '').padEnd(7, '0');

  return BigInt(whole) * 10_000_000n + BigInt(fraction || '0');
}

export default function StellarFiatModal({
  isOpen,
  onClose,
  defaultAmount = '',
  fiatCurrency = 'usd',
  isAdminMode = false,
  recipientAddress = '',
  onDepositSuccess,
}: StellarFiatModalProps) {
  const { connection, signTx } = useStellarWallet();

  const [amount, setAmount] = useState(defaultAmount);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [recipient, setRecipient] = useState(recipientAddress);
  const [fiatEstimate, setFiatEstimate] = useState<string | null>(null);

  const AMOUNT_PRESETS = [5, 10, 25, 50, 100];

  const handlePreset = (value: number) => {
    setAmount(String(value));
    setActivePreset(value);
  };
  const [status, setStatus] = useState<TxStatus>('idle');
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoadingUI, setIsLoadingUI] = useState(true);
  const [bridgeLimit, setBridgeLimit] = useState<bigint | null>(null);
  const [bridgeLimitError, setBridgeLimitError] = useState('');
  const [isLoadingBridgeLimit, setIsLoadingBridgeLimit] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingUI(true);
      const timer = setTimeout(() => setIsLoadingUI(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setAmount(defaultAmount);
    setRecipient(recipientAddress);
    setActivePreset(null);
    setStatus('idle');
    setTxHash('');
    setErrorMsg('');

    if (isAdminMode) {
      setBridgeLimit(null);
      setBridgeLimitError('');
      setIsLoadingBridgeLimit(false);
      return;
    }

    let cancelled = false;

    setBridgeLimit(null);
    setBridgeLimitError('');
    setIsLoadingBridgeLimit(true);

    getBridgeLimit()
      .then((limit) => {
        if (!cancelled) {
          setBridgeLimit(limit);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBridgeLimitError(
            'Unable to load the current on-chain bridge limit. Deposits are temporarily disabled.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingBridgeLimit(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultAmount, isAdminMode, isOpen, recipientAddress]);

  // Live fiat estimate: recalculate whenever amount or fiatCurrency changes
  const updateFiatEstimate = useCallback(async () => {
    const xlm = parseFloat(amount);
    if (!xlm || xlm <= 0) {
      setFiatEstimate(null);
      return;
    }
    try {
      const price = await getTokenPrice('XLM', fiatCurrency);
      setFiatEstimate(formatFiatAmount(xlm * price, fiatCurrency));
    } catch {
      setFiatEstimate(null);
    }
  }, [amount, fiatCurrency]);

  useEffect(() => {
    updateFiatEstimate();
  }, [updateFiatEstimate]);

  if (!isOpen) return null;

  const stroopsAmount = parseAmountToStroops(amount);
  const hasValidAmount = stroopsAmount !== null && stroopsAmount > BigInt(0);
  const isDepositFlow = !isAdminMode;
  const isLimitUnavailable =
    isDepositFlow && !isLoadingBridgeLimit && (bridgeLimit === null || !!bridgeLimitError);
  const isOverLimit =
    isDepositFlow &&
    bridgeLimit !== null &&
    hasValidAmount &&
    stroopsAmount > bridgeLimit;
  const usagePercent =
    isDepositFlow && bridgeLimit !== null && bridgeLimit > BigInt(0) && stroopsAmount !== null
      ? Number((stroopsAmount * 10_000n) / bridgeLimit) / 100
      : 0;
  const isHighLimitUsage =
    isDepositFlow && !isOverLimit && hasValidAmount && usagePercent >= BRIDGE_LIMIT_WARNING_PERCENT;
  const remainingLimit =
    isDepositFlow && bridgeLimit !== null && stroopsAmount !== null && bridgeLimit > stroopsAmount
      ? bridgeLimit - stroopsAmount
      : BigInt(0);
  const isSubmitDisabled =
    status === 'loading' ||
    !connection.isConnected ||
    (isDepositFlow && (isLoadingBridgeLimit || isLimitUnavailable || isOverLimit));

  const handleAction = async () => {
    if (!connection.isConnected) return;

    if (!amount || stroopsAmount === null || stroopsAmount <= BigInt(0)) {
      setErrorMsg('Please enter a valid amount.');
      setStatus('error');
      return;
    }

    if (isDepositFlow && isLoadingBridgeLimit) {
      setErrorMsg('Still loading the current bridge limit. Please wait a moment.');
      setStatus('error');
      return;
    }

    if (isDepositFlow && (bridgeLimit === null || bridgeLimitError)) {
      setErrorMsg(
        bridgeLimitError ||
          'Unable to validate against the current bridge limit. Please try again.',
      );
      setStatus('error');
      return;
    }

    if (isDepositFlow && bridgeLimit !== null && stroopsAmount > bridgeLimit) {
      setErrorMsg(
        `Requested amount exceeds the current bridge limit of ${stroopsToDisplay(bridgeLimit)} XLM.`,
      );
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMsg('');
    try {
      let hash: string;
      if (isAdminMode) {
        const to = recipient || connection.publicKey;
        hash = await withdrawFromContract(
          connection.publicKey,
          to,
          stroopsAmount,
          signTx,
        );
      } else {
        hash = await depositToContract(
          connection.publicKey,
          stroopsAmount,
          signTx,
        );
      }
      setTxHash(hash);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Transaction failed');
      setStatus('error');
    }
  };

  const handleClose = () => {
    setStatus('idle');
    setTxHash('');
    setErrorMsg('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md mx-4 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <ArrowDownUp className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">
              {isAdminMode ? 'Withdraw from Bridge' : 'Deposit to Bridge'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {status === 'success' ? (
          <div data-testid="success-message" className="text-center py-6">
            <CheckCircle className="w-14 h-14 text-green-400 mx-auto mb-4" />
            <p className="text-white font-semibold text-lg mb-2">
              Transaction Confirmed!
            </p>
            <p className="text-gray-400 text-sm mb-4">
              {isAdminMode ? 'Withdrawal' : 'Deposit'} of{' '}
              <span className="text-white font-medium">
                {stroopsToDisplay(stroopsAmount ?? BigInt(0))} XLM
              </span>{' '}
              processed successfully.
            </p>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline text-xs break-all"
            >
              {txHash}
            </a>
            {!isAdminMode && onDepositSuccess ? (
              <button
                onClick={() => {
                  onDepositSuccess(parseFloat(amount || '0'));
                }}
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors"
              >
                Continue to Fiat Payout
              </button>
            ) : (
              <button
                onClick={handleClose}
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
            )}
          </div>
        ) : isLoadingUI ? (
          <SkeletonPayout />
        ) : (
          <>
            {/* Amount input */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">
                Amount (XLM)
              </label>
              <div className="flex gap-2 mb-2">
                {AMOUNT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePreset(preset)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      activePreset === preset
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-blue-500 hover:text-white'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="0"
                step="0.0000001"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setActivePreset(null);
                }}
                placeholder="0.00"
                aria-invalid={isOverLimit ? true : undefined}
                className={`w-full bg-gray-800 border rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none ${isOverLimit ? 'border-red-500 focus:border-red-400' : 'border-gray-600 focus:border-blue-500'}`}
              />
            </div>

            {/* Fiat estimate */}
            {fiatEstimate && (
              <p className="text-xs text-gray-400 -mt-2 mb-4">
                ≈ <span className="text-white font-medium">{fiatEstimate}</span>{' '}
                at current market rate
              </p>
            )}

            {isDepositFlow && (
              <div className="mb-4 rounded-xl border border-gray-700 bg-gray-800/60 px-4 py-3">
                <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                  <span>On-chain per-deposit limit</span>
                  <span>
                    {isLoadingBridgeLimit
                      ? 'Loading...'
                      : bridgeLimit !== null
                        ? `${stroopsToDisplay(bridgeLimit)} XLM`
                        : 'Unavailable'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-200 mb-2">
                  <span>Requested amount</span>
                  <span>
                    {hasValidAmount && stroopsAmount !== null
                      ? `${stroopsToDisplay(stroopsAmount)} XLM`
                      : 'Enter an amount'}
                  </span>
                </div>

                <div className="h-2 w-full rounded-full bg-gray-700 overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all ${isOverLimit ? 'bg-red-500' : isHighLimitUsage ? 'bg-amber-400' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>
                    {hasValidAmount && bridgeLimit !== null
                      ? `${usagePercent.toFixed(2)}% of limit`
                      : `High-usage warning at ${BRIDGE_LIMIT_WARNING_PERCENT}%`}
                  </span>
                  <span>
                    {hasValidAmount && bridgeLimit !== null
                      ? `${stroopsToDisplay(remainingLimit)} XLM remaining`
                      : 'Awaiting input'}
                  </span>
                </div>

                {bridgeLimitError && (
                  <div className="mt-3 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">
                    {bridgeLimitError}
                  </div>
                )}

                {isHighLimitUsage && bridgeLimit !== null && (
                  <div className="mt-3 rounded-lg border border-amber-700 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
                    This request uses {usagePercent.toFixed(2)}% of the current on-chain limit of{' '}
                    {stroopsToDisplay(bridgeLimit)} XLM.
                  </div>
                )}

                {isOverLimit && bridgeLimit !== null && stroopsAmount !== null && (
                  <div className="mt-3 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-300">
                    Requested {stroopsToDisplay(stroopsAmount)} XLM exceeds the current on-chain limit of{' '}
                    {stroopsToDisplay(bridgeLimit)} XLM.
                  </div>
                )}
              </div>
            )}

            {/* Recipient */}
            {isAdminMode && (
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-1">
                  Recipient address (leave blank for self)
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="G..."
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
                />
              </div>
            )}

            {/* Info */}
            <div data-testid="wallet-info" className="flex justify-between text-xs text-gray-500 mb-6">
              <span>
                Connected: {connection.address.slice(0, 8)}…
                {connection.address.slice(-4)}
              </span>
              <span>Network: {connection.network || 'TESTNET'}</span>
            </div>

            {/* Error */}
            {status === 'error' && (
              <div
                data-testid="error-message"
                className="flex items-center gap-2 text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mb-4 text-sm"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* CTA */}
            <button
              onClick={handleAction}
              disabled={isSubmitDisabled}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-all"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 data-testid="loading-spinner" className="w-4 h-4 animate-spin" />
                  Signing & submitting…
                </>
              ) : isAdminMode ? (
                'Withdraw'
              ) : (
                'Deposit'
              )}
            </button>

            {!connection.isConnected && (
              <p className="text-center text-xs text-gray-500 mt-3">
                Connect your Freighter wallet to continue.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
