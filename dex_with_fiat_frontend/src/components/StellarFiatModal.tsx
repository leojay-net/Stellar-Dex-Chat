'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { pollTransaction } from '@/lib/stellarContract';
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowDownUp,
  Download,
  WifiOff,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import CopyButton from '@/components/ui/CopyButton';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import {
  BRIDGE_LIMIT_WARNING_PERCENT,
  CONTRACT_ID,
  depositToContract,
  withdrawFromContract,
  clearCache, // Assuming this is also from stellarContract
} from '@/lib/stellarContract';
import { xlmToStroops, stroopsToXlm as stroopsToDisplay } from '@/lib/stroops';
import type { FeeEstimate } from '@/lib/stellarContract';
import useBridgeStats from '@/hooks/useBridgeStats';
import { getTokenPrice, formatFiatAmount } from '@/lib/cryptoPriceService';
import SkeletonPayout from '@/components/ui/skeleton/SkeletonPayout';
import { useNotifications } from '@/hooks/useNotifications';
import { useTxHistory } from '@/hooks/useTxHistory';
import { downloadReceipt } from '@/lib/receipt';
import type { ChatMessage } from '@/types';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import { useIdempotentAction } from '@/hooks/useIdempotentAction';

interface StellarFiatModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAmount?: string;
  fiatCurrency?: string;
  isAdminMode?: boolean;
  recipientAddress?: string;
  onDepositSuccess?: (result: { xlmAmount: number; note?: string }) => void;
  messages?: ChatMessage[];
}

type TxStatus = 'idle' | 'loading' | 'success' | 'error';

const PENDING_TX_KEY = 'stellar_pending_tx';
const LARGE_AMOUNT_RISK_THRESHOLD = 500;
const RISK_CONFIRMATION_PHRASE = 'CONFIRM LARGE AMOUNT';
const SUBMIT_COOLDOWN_MS = 2000;

interface PendingTxRecord {
  hash: string;
  amount: string;
  isAdminMode: boolean;
  recipient: string;
  idempotencyKey?: string;
}

export default function StellarFiatModal({
  isOpen,
  onClose,
  defaultAmount = '',
  fiatCurrency = 'usd',
  isAdminMode = false,
  recipientAddress = '',
  onDepositSuccess,
  messages = [],
}: StellarFiatModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { connection, signTx } = useStellarWallet();
  const { addNotification } = useNotifications();
  const { addEntry } = useTxHistory();

  const { execute: executeTransaction, isProcessing: isTxProcessing } =
    useIdempotentAction({
      cooldownMs: SUBMIT_COOLDOWN_MS,
      logSuppressed: true,
    });

  const [amount, setAmount] = useState(defaultAmount);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [recipient, setRecipient] = useState(recipientAddress);
  const [fiatEstimate, setFiatEstimate] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [riskConfirmation, setRiskConfirmation] = useState('');
  const [lastLoggedRiskAmount, setLastLoggedRiskAmount] = useState('');
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [requiresPreSignConfirmation, setRequiresPreSignConfirmation] =
    useState(false);
  const [isLoadingFee, setIsLoadingFee] = useState(false);
  const [status, setStatus] = useState<TxStatus>('idle');
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoadingUI, setIsLoadingUI] = useState(true);
  const [lastActionTimestamp, setLastActionTimestamp] = useState(0);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  useEffect(() => {
    if (!isOpen || !connection.isConnected || !connection.publicKey) {
      setWalletBalance(null);
      return;
    }

    let cancelled = false;
    setIsLoadingBalance(true);

    const fetchBalance = async () => {
      try {
        const horizonUrl =
          connection.network?.toUpperCase() === 'PUBLIC'
            ? 'https://horizon.stellar.org'
            : 'https://horizon-testnet.stellar.org';
        const res = await fetch(
          `${horizonUrl}/accounts/${connection.publicKey}`,
        );
        if (!res.ok) throw new Error('Failed to fetch account');
        const data = await res.json();
        const native = (
          data.balances as Array<{ asset_type: string; balance: string }>
        ).find((b) => b.asset_type === 'native');
        if (!cancelled && native) {
          setWalletBalance(native.balance);
        }
      } catch {
        if (!cancelled) {
          setWalletBalance(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBalance(false);
        }
      }
    };

    void fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    connection.isConnected,
    connection.publicKey,
    connection.network,
  ]);

  const {
    limit: bridgeLimit,
    loading: isLoadingBridgeLimit,
    error: bridgeLimitError,
    refetchStats,
  } = useBridgeStats();

  const AMOUNT_PRESETS = [5, 10, 25, 50, 100];

  const handlePreset = (value: number) => {
    setAmount(String(value));
    setActivePreset(value);
  };

  useEffect(() => {
    if (isOpen) {
      setIsLoadingUI(true);
      const timer = setTimeout(() => setIsLoadingUI(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setAmount(defaultAmount);
    setRecipient(recipientAddress);
    setActivePreset(null);
    setStatus('idle');
    setTxHash('');
    setErrorMsg('');
    setFeeEstimate(null);
    setRequiresPreSignConfirmation(false);
    setNote('');
    setRiskConfirmation('');
    setLastLoggedRiskAmount('');
    setLastActionTimestamp(0);

    if (isAdminMode) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (!cancelled) {
        await refetchStats();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    defaultAmount,
    isAdminMode,
    isOpen,
    recipientAddress,
    refetchStats,
    connection.network,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const stored = localStorage.getItem(PENDING_TX_KEY);
    if (!stored) {
      return;
    }

    let pending: PendingTxRecord;
    try {
      pending = JSON.parse(stored) as PendingTxRecord;
    } catch {
      localStorage.removeItem(PENDING_TX_KEY);
      return;
    }

    setAmount(pending.amount);
    setRecipient(pending.recipient);
    setStatus('loading');
    setErrorMsg('');
    setTxHash('');

    let cancelled = false;
    pollTransaction(pending.hash)
      .then((hash) => {
        if (cancelled) {
          return;
        }
        setTxHash(hash);
        setStatus('success');
        localStorage.removeItem(PENDING_TX_KEY);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setErrorMsg('Recovered transaction failed on-chain');
        setStatus('error');
        localStorage.removeItem(PENDING_TX_KEY);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !connection.isConnected) {
      setFeeEstimate(null);
      return;
    }

    const currentStroops = xlmToStroops(amount);
    if (!currentStroops || currentStroops <= BigInt(0)) {
      setFeeEstimate(null);
      return;
    }

    let cancelled = false;
    setIsLoadingFee(true);

    const simulate = async () => {
      try {
        let estimate: FeeEstimate | null = null;
        if (isAdminMode) {
          const to = recipient || connection.publicKey;
          const { simulateWithdraw } = await import('@/lib/stellarContract');
          estimate = await simulateWithdraw(
            connection.publicKey,
            to,
            currentStroops,
          );
        } else {
          const { simulateDeposit } = await import('@/lib/stellarContract');
          estimate = await simulateDeposit(
            connection.publicKey,
            currentStroops,
          );
        }
        if (!cancelled) {
          setFeeEstimate(estimate);
        }
      } catch {
        if (!cancelled) {
          setFeeEstimate(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingFee(false);
        }
      }
    };

    const timer = setTimeout(simulate, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    amount,
    connection.isConnected,
    connection.publicKey,
    isAdminMode,
    isOpen,
    recipient,
  ]);

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
    void updateFiatEstimate();
  }, [updateFiatEstimate]);

  const numericAmount = Number.parseFloat(amount);
  const isAmountInvalid = !Number.isFinite(numericAmount) || numericAmount <= 0;
  const stroopsAmount = !isAmountInvalid ? xlmToStroops(amount) : null;
  const hasValidAmount = stroopsAmount !== null && stroopsAmount > BigInt(0);
  const isRiskyAmount =
    Number.isFinite(numericAmount) &&
    numericAmount >= LARGE_AMOUNT_RISK_THRESHOLD;
  const isDepositFlow = !isAdminMode;
  const isLimitUnavailable =
    isDepositFlow &&
    !isLoadingBridgeLimit &&
    (bridgeLimit === null || !!bridgeLimitError);
  const isOverLimit =
    isDepositFlow &&
    bridgeLimit !== null &&
    hasValidAmount &&
    stroopsAmount !== null &&
    stroopsAmount > bridgeLimit;
  const usagePercent =
    isDepositFlow &&
    bridgeLimit !== null &&
    bridgeLimit > BigInt(0) &&
    stroopsAmount !== null
      ? Number((stroopsAmount * 10_000n) / bridgeLimit) / 100
      : 0;
  const isHighLimitUsage =
    isDepositFlow &&
    !isOverLimit &&
    hasValidAmount &&
    usagePercent >= BRIDGE_LIMIT_WARNING_PERCENT;
  const remainingLimit =
    isDepositFlow &&
    bridgeLimit !== null &&
    stroopsAmount !== null &&
    bridgeLimit > stroopsAmount
      ? bridgeLimit - stroopsAmount
      : BigInt(0);
  const isSubmitDisabled =
    status === 'loading' ||
    !connection.isConnected ||
    isAmountInvalid ||
    (isDepositFlow &&
      (isLoadingBridgeLimit || isLimitUnavailable || isOverLimit)) ||
    (isRiskyAmount &&
      riskConfirmation.trim().toUpperCase() !== RISK_CONFIRMATION_PHRASE) ||
    Date.now() - lastActionTimestamp < SUBMIT_COOLDOWN_MS;

  const operationType = isAdminMode ? 'Withdraw' : 'Deposit';
  const txNetwork = connection.network || 'TESTNET';

  useAccessibleModal(isOpen, modalRef, onClose);

  useEffect(() => {
    if (
      !isOpen ||
      !isRiskyAmount ||
      !hasValidAmount ||
      amount === lastLoggedRiskAmount
    ) {
      return;
    }

    addEntry({
      kind: 'risk_warning',
      status: 'warning',
      amount,
      asset: 'XLM',
      note: note.trim() || undefined,
      message: `Large deposit warning shown for ${amount} XLM`,
    });
    addNotification(
      'risk_warning',
      `Large amount warning: ${amount} XLM requires typed confirmation.`,
    );
    setLastLoggedRiskAmount(amount);
  }, [
    addEntry,
    addNotification,
    amount,
    hasValidAmount,
    isOpen,
    isRiskyAmount,
    lastLoggedRiskAmount,
    note,
  ]);

  if (!isOpen) return null;

  const handleAction = async () => {
    if (!connection.isConnected) return;

    if (
      isAmountInvalid ||
      !amount ||
      stroopsAmount === null ||
      stroopsAmount <= BigInt(0)
    ) {
      setErrorMsg('Invalid amount. Please enter a positive number.');
      setStatus('error');
      return;
    }
    if (isDepositFlow && isLoadingBridgeLimit) {
      setErrorMsg(
        'Still loading the current bridge limit. Please wait a moment.',
      );
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
    if (
      isRiskyAmount &&
      riskConfirmation.trim().toUpperCase() !== RISK_CONFIRMATION_PHRASE
    ) {
      setErrorMsg(
        `Type "${RISK_CONFIRMATION_PHRASE}" to confirm this large transfer.`,
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

    if (status === 'loading' || isTxProcessing) {
      return;
    }

    await executeTransaction(
      async (generatedIdempotencyKey) => {
        setStatus('loading');
        setErrorMsg('');

        console.log(
          `[StellarFiatModal] Initiating ${isAdminMode ? 'withdraw' : 'deposit'} with idempotencyKey: ${generatedIdempotencyKey}`,
        );

        const onHashKnown = (hash: string) => {
          localStorage.setItem(
            PENDING_TX_KEY,
            JSON.stringify({
              hash,
              amount,
              isAdminMode,
              recipient,
              idempotencyKey: generatedIdempotencyKey,
            } satisfies PendingTxRecord),
          );
        };

        try {
          addNotification(
            'tx_submit',
            `Submitting ${isAdminMode ? 'withdrawal' : 'deposit'} transaction...`,
          );
          let hash: string;
          if (isAdminMode) {
            const to = recipient || connection.publicKey;
            hash = await withdrawFromContract(
              connection.publicKey,
              to,
              stroopsAmount,
              signTx,
              onHashKnown,
            );
          } else {
            hash = await depositToContract(
              connection.publicKey,
              stroopsAmount,
              signTx,
              onHashKnown,
            );
          }

          setTxHash(hash);
          setStatus('success');
          clearCache();
          localStorage.removeItem(PENDING_TX_KEY);
          addNotification(
            'tx_confirm',
            `Transaction confirmed successfully! (${hash.slice(0, 8)}...)`,
          );
          addEntry({
            kind: isAdminMode ? 'payout' : 'deposit',
            status: 'completed',
            amount,
            asset: 'XLM',
            note: note.trim() || undefined,
            txHash: hash,
            message: `${isAdminMode ? 'Withdrawal' : 'Deposit'} confirmed on Stellar.`,
          });
          try {
            await refetchStats();
          } catch {
            // ignore refresh failures after a confirmed transaction
          }
          if (!isAdminMode && onDepositSuccess) {
            onDepositSuccess({
              xlmAmount: parseFloat(amount || '0'),
              note: note.trim() || undefined,
            });
          }
        } catch (err) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Transaction failed',
          );
          setStatus('error');
          localStorage.removeItem(PENDING_TX_KEY);
        }
      },
      `stellar_${isAdminMode ? 'withdraw' : 'deposit'}`,
    );
  };

  const handleClose = () => {
    setStatus('idle');
    setTxHash('');
    setErrorMsg('');
    setRequiresPreSignConfirmation(false);
    onClose();
  };

  return (
    <div className="theme-overlay fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={isAdminMode ? 'Withdraw from Bridge' : 'Deposit to Bridge'}
        tabIndex={-1}
        className="theme-surface theme-border relative w-full max-w-md mx-4 border rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <ArrowDownUp className="w-5 h-5 text-blue-400" />
            <h2 className="theme-text-primary text-lg font-semibold">
              {isAdminMode ? 'Withdraw from Bridge' : 'Deposit to Bridge'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="theme-text-muted hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {status === 'success' ? (
          <div data-testid="success-message" className="text-center py-6">
            <CheckCircle className="w-14 h-14 text-green-400 mx-auto mb-4" />
            <p className="theme-text-primary font-semibold text-lg mb-2">
              Transaction Confirmed!
            </p>
            <p className="theme-text-secondary text-sm mb-4">
              {isAdminMode ? 'Withdrawal' : 'Deposit'} of{' '}
              <span className="theme-text-primary font-medium">
                {stroopsToDisplay(stroopsAmount ?? BigInt(0))} XLM
              </span>{' '}
              processed successfully.
            </p>
            {note && (
              <p className="theme-text-secondary text-xs mb-4">
                Note: <span className="theme-text-primary">{note}</span>
              </p>
            )}
            <div className="flex items-center justify-center gap-2 mt-1">
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline text-xs break-all"
              >
                {txHash}
              </a>
              <CopyButton value={txHash} />
            </div>

            <button
              type="button"
              data-testid="download-receipt-button"
              onClick={() =>
                downloadReceipt({
                  txHash,
                  amount: stroopsToDisplay(stroopsAmount ?? BigInt(0)),
                  wallet: connection.publicKey,
                  network: connection.network || 'TESTNET',
                  timestamp: new Date().toLocaleString(),
                  type: isAdminMode ? 'Withdrawal' : 'Deposit',
                  note: note.trim() || undefined,
                  messages,
                })
              }
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              Download Receipt
            </button>

            {!isAdminMode && onDepositSuccess ? (
              <button
                onClick={() =>
                  onDepositSuccess({
                    xlmAmount: parseFloat(amount || '0'),
                    note: note.trim() || undefined,
                  })
                }
                className="theme-primary-button mt-6 w-full py-3 rounded-lg font-medium transition-colors"
              >
                Continue to Fiat Payout
              </button>
            ) : (
              <button
                onClick={handleClose}
                className="theme-primary-button mt-6 w-full py-3 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
            )}
          </div>
        ) : isLoadingUI ? (
          <SkeletonPayout />
        ) : (
          <>
            <div className="mb-4">
              <label className="theme-text-secondary block text-sm mb-1">
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
                        : 'theme-surface-muted theme-border theme-text-secondary hover:border-blue-500 hover:text-[var(--color-text-primary)]'
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
                aria-invalid={isAmountInvalid || isOverLimit ? true : undefined}
                className={`theme-input w-full border rounded-lg px-4 py-3 focus:outline-none ${
                  isAmountInvalid || isOverLimit
                    ? 'border-red-500 focus:border-red-400'
                    : 'focus:border-blue-500'
                }`}
              />
              {isAmountInvalid && amount && (
                <p className="theme-soft-danger flex items-center gap-2 rounded-lg px-3 py-2 mt-2 text-xs">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Invalid amount. Please enter a positive number.
                </p>
              )}
              {connection.isConnected && (
                <p className="theme-text-secondary text-xs mt-2">
                  Available:{' '}
                  <span className="theme-text-primary font-medium">
                    {isLoadingBalance
                      ? 'Loading...'
                      : walletBalance !== null
                        ? `${walletBalance} XLM`
                        : 'Unable to fetch balance'}
                  </span>
                </p>
              )}
            </div>

            {fiatEstimate && (
              <p className="theme-text-secondary text-xs -mt-2 mb-4">
                ~={' '}
                <span className="theme-text-primary font-medium">
                  {fiatEstimate}
                </span>{' '}
                at current market rate
              </p>
            )}

            <div className="mb-4">
              <label className="theme-text-secondary block text-sm mb-1">
                Optional note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  isAdminMode
                    ? 'Add a label for this withdrawal'
                    : 'Add a note for this deposit'
                }
                rows={2}
                maxLength={160}
                className="theme-input w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            {(isLoadingFee || feeEstimate) && (
              <div className="theme-surface-muted theme-border mb-4 rounded-xl border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="theme-text-muted text-[10px] font-bold uppercase tracking-widest">
                    Simulation Results
                  </h3>
                  {isLoadingFee && (
                    <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="theme-text-muted">Base Fee</span>
                    <span className="theme-text-secondary font-mono">
                      {isLoadingFee
                        ? '...'
                        : feeEstimate
                          ? `${feeEstimate.baseFee.toFixed(7)} XLM`
                          : '0.0000100 XLM'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="theme-text-muted">Resource Fee</span>
                    <span className="theme-text-secondary font-mono">
                      {isLoadingFee
                        ? '...'
                        : feeEstimate
                          ? `${feeEstimate.resourceFee.toFixed(7)} XLM`
                          : '0.0000000 XLM'}
                    </span>
                  </div>
                  <div className="theme-border pt-2 mt-1 border-t flex justify-between text-xs font-semibold">
                    <span className="theme-text-secondary">
                      Total Network Fee
                    </span>
                    <span className="text-blue-400 font-mono">
                      {isLoadingFee
                        ? 'Calculating...'
                        : feeEstimate
                          ? `${feeEstimate.fee.toFixed(7)} XLM`
                          : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {requiresPreSignConfirmation && status !== 'loading' && (
              <div className="theme-surface-muted theme-border mb-4 rounded-xl border px-4 py-3">
                <h3 className="theme-text-muted text-[10px] font-bold uppercase tracking-widest mb-3">
                  Pre-Sign Transaction Summary
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="theme-text-secondary">Operation</span>
                    <span className="theme-text-primary font-medium">
                      {operationType}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="theme-text-secondary">Amount</span>
                    <span className="theme-text-primary font-medium">
                      {stroopsToDisplay(stroopsAmount ?? BigInt(0))} XLM
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="theme-text-secondary">Network</span>
                    <span className="theme-text-primary font-medium">
                      {txNetwork}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="theme-text-secondary">Contract</span>
                    <span className="theme-text-primary font-mono text-[10px] break-all text-right">
                      {CONTRACT_ID}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setRequiresPreSignConfirmation(false)}
                    className="theme-border theme-text-secondary flex-1 rounded-lg border py-2 text-xs font-medium hover:theme-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAction()}
                    className="theme-primary-button flex-1 rounded-lg py-2 text-xs font-semibold"
                  >
                    Confirm & Sign
                  </button>
                </div>
              </div>
            )}

            {isDepositFlow && (
              <div className="theme-surface-muted theme-border mb-4 rounded-xl border px-4 py-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="theme-text-muted text-[10px] font-bold uppercase tracking-widest">
                    Bridge Capacity
                  </h3>
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isOverLimit
                        ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                        : isHighLimitUsage
                          ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                          : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                    }`}
                  />
                </div>

                {isLimitUnavailable ? (
                  <EmptyState
                    icon={WifiOff}
                    title="Bridge data unavailable"
                    description={
                      bridgeLimitError ??
                      'Could not fetch the current bridge limit. Please retry.'
                    }
                    cta={{ label: 'Retry', onClick: () => void refetchStats() }}
                    className="py-2"
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="theme-text-secondary">
                        On-chain per-deposit limit
                      </span>
                      <span className="theme-text-primary font-mono">
                        {isLoadingBridgeLimit
                          ? 'Loading...'
                          : bridgeLimit !== null
                            ? `${stroopsToDisplay(bridgeLimit)} XLM`
                            : 'Unavailable'}
                      </span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-[var(--color-surface-elevated)] overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isOverLimit
                            ? 'bg-red-500'
                            : isHighLimitUsage
                              ? 'bg-amber-400'
                              : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(usagePercent, 100)}%` }}
                      />
                    </div>

                    <div className="theme-text-muted flex items-center justify-between text-[10px]">
                      <span>
                        {hasValidAmount && bridgeLimit !== null
                          ? `${usagePercent.toFixed(1)}% used`
                          : 'Limit utilized per transaction'}
                      </span>
                      <span>
                        {hasValidAmount && bridgeLimit !== null
                          ? `${stroopsToDisplay(remainingLimit)} XLM available`
                          : ''}
                      </span>
                    </div>

                    {isOverLimit &&
                      bridgeLimit !== null &&
                      stroopsAmount !== null && (
                        <div className="theme-soft-danger mt-3 rounded-lg border px-3 py-2 text-[11px] leading-tight">
                          Error: Amount exceeds the current bridge limit.
                        </div>
                      )}
                  </>
                )}
              </div>
            )}

            {isRiskyAmount && (
              <div className="theme-soft-warning mb-4 rounded-xl border px-4 py-3">
                <p className="font-semibold text-sm mb-2">
                  Large amount confirmation required
                </p>
                <p className="text-xs mb-3">
                  Amounts above {LARGE_AMOUNT_RISK_THRESHOLD} XLM require an
                  additional confirmation phrase before submission.
                </p>
                <input
                  type="text"
                  value={riskConfirmation}
                  onChange={(e) => setRiskConfirmation(e.target.value)}
                  placeholder={RISK_CONFIRMATION_PHRASE}
                  className="theme-input w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            {isAdminMode && (
              <div className="mb-4">
                <label className="theme-text-secondary block text-sm mb-1">
                  Recipient address (leave blank for self)
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="G..."
                  className="theme-input w-full border rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 font-mono text-sm"
                />
              </div>
            )}

            <div
              data-testid="wallet-info"
              className="theme-text-muted flex justify-between text-xs mb-6"
            >
              <span className="flex items-center gap-1">
                <span>
                  Connected: {connection.address.slice(0, 8)}…
                  {connection.address.slice(-4)}
                </span>
                <CopyButton value={connection.address} iconClassName="w-3 h-3" />
              </span>
              <span>Network: {connection.network || 'TESTNET'}</span>
            </div>

            {status === 'error' && (
              <div
                data-testid="error-message"
                className="theme-soft-danger flex items-center gap-2 border rounded-lg px-3 py-2 mb-4 text-sm"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleAction}
                disabled={isSubmitDisabled || isTxProcessing}
                className="theme-primary-button w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-all"
              >
                {status === 'loading' || isTxProcessing ? (
                  <>
                    <Loader2
                      data-testid="loading-spinner"
                      className="w-4 h-4 animate-spin"
                    />
                    Signing & submitting…
                  </>
                ) : isAdminMode ? (
                  'Withdraw'
                ) : requiresPreSignConfirmation ? (
                  'Awaiting Confirmation'
                ) : (
                  'Review Transaction'
                ) // Assuming this is also from stellarContract
                }
              </button>

              <button
                type="button"
                onClick={() => {
                  setAmount('100');
                  setTxHash(
                    'MOCK' +
                      Math.random().toString(36).substring(2, 10).toUpperCase(),
                  );
                  setStatus('success');
                }}
                className="w-full text-[10px] text-gray-500 hover:text-blue-400 transition-colors py-1"
              >
                (Demo: Simulate Success)
              </button>
            </div>

            {!connection.isConnected && (
              <p className="theme-text-muted text-center text-xs mt-3">
                Connect your Freighter wallet to continue.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
