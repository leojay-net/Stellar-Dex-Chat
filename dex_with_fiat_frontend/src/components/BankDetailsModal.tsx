'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Search,
  Building2,
  Trash2,
  Edit2,
  Save,
  UserPlus,
  Star,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { fetchLockedQuote, type LockedQuote } from '@/lib/cryptoPriceService';
import SkeletonWallet from '@/components/ui/skeleton/SkeletonWallet';
import { useNotifications } from '@/hooks/useNotifications';
import { useBeneficiaries, Beneficiary } from '@/hooks/useBeneficiaries';
import { useTxHistory } from '@/hooks/useTxHistory';
import TransferTimeline, {
  StatusEvent,
  TransferStatus,
} from '@/components/TransferTimeline';
import CopyButton from '@/components/ui/CopyButton';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import { useIdempotentAction } from '@/hooks/useIdempotentAction';
import { getOrCreateClientSessionId } from '@/lib/clientSession';
import { chatTelemetry } from '@/lib/chatTelemetry';
import { z } from 'zod';

export const bankDetailsSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be exactly 10 digits'),
  saveCustomName: z.string().max(50, 'Beneficiary name must be less than 50 characters').optional(),
  payoutNote: z.string().max(160, 'Note must be less than 160 characters').optional(),
});

interface Bank {
  id: number;
  name: string;
  code: string;
  active: boolean;
  country: string;
  currency: string;
  type: string;
}

interface VerifyAccountData {
  account_name: string;
}

interface CreateRecipientData {
  recipient_code: string;
  [key: string]: unknown;
}

interface InitiateTransferData {
  reference: string;
  transfer_code: string;
  status: string;
  [key: string]: unknown;
}

export interface BankDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  xlmAmount: number;
}

type Step = 1 | 2 | 3 | 4;

export default function BankDetailsModal({
  isOpen,
  onClose,
  xlmAmount,
}: BankDetailsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const {
    beneficiaries,
    isLoaded: beneficiariesLoaded,
    addBeneficiary,
    renameBeneficiary,
    deleteBeneficiary,
  } = useBeneficiaries();

  const { addNotification } = useNotifications();
  const { addEntry } = useTxHistory();

  const { execute: executePayoutConfirm, isProcessing: isPayoutProcessing } =
    useIdempotentAction({
      cooldownMs: 3000,
      logSuppressed: true,
    });

  const [step, setStep] = useState<Step>(1);

  // Saved beneficiary selection
  const [showSavedBeneficiaries, setShowSavedBeneficiaries] = useState(false);
  const [selectedSavedBeneficiary, setSelectedSavedBeneficiary] =
    useState<Beneficiary | null>(null);
  const [editingBeneficiaryId, setEditingBeneficiaryId] = useState<
    string | null
  >(null);
  const [editingName, setEditingName] = useState('');
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveCustomName, setSaveCustomName] = useState('');

  // Step 1 - bank selection
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState('');
  const [bankSearch, setBankSearch] = useState('');
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);

  // Step 2 - account details
  const [accountNumber, setAccountNumber] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifiedAccount, setVerifiedAccount] =
    useState<VerifyAccountData | null>(null);

  // Step 3 - confirm payout
  const [lockedQuote, setLockedQuote] = useState<LockedQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteSecondsLeft, setQuoteSecondsLeft] = useState(120);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutError, setPayoutError] = useState('');
  const [payoutNote, setPayoutNote] = useState('');

  // Step 4 — success & status tracking
  const [transferReference, setTransferReference] = useState('');
  const [transferStatus, setTransferStatus] = useState<
    'pending' | 'success' | 'failed' | 'reversed'
  >('pending');

  // Transfer timeline
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [isPollingStatus, setIsPollingStatus] = useState(false);

  const pushStatusEvent = (status: TransferStatus, label?: string) => {
    setStatusEvents((prev: StatusEvent[]) => [
      ...prev,
      { status, timestamp: new Date(), label },
    ]);
  };

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      chatTelemetry.fiatPayoutStep({ action: 'open', step: 1, xlmAmount });
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, xlmAmount]);

  useEffect(() => {
    if (!isOpen) return;
    chatTelemetry.fiatPayoutStep({ action: 'step_change', step, xlmAmount });
  }, [step, isOpen, xlmAmount]);

  // Fetch banks when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setBanksLoading(true);
    setBanksError('');
    fetch('/api/banks')
      .then((r) => r.json())
      .then((json: { success: boolean; data: Bank[]; message?: string }) => {
        if (json.success) {
          setBanks(json.data);
        } else {
          setBanksError(json.message ?? 'Failed to load banks');
        }
      })
      .catch(() => setBanksError('Failed to load banks. Please try again.'))
      .finally(() => setBanksLoading(false));
  }, [isOpen]);

  // Fetch a locked quote when the user reaches step 3
  const fetchQuote = useCallback(() => {
    if (xlmAmount <= 0) return;
    setQuoteLoading(true);
    setLockedQuote(null);
    fetchLockedQuote('XLM', xlmAmount, 'ngn')
      .then((quote) => {
        setLockedQuote(quote);
        setQuoteSecondsLeft(120);
      })
      .catch(() => setLockedQuote(null))
      .finally(() => setQuoteLoading(false));
  }, [xlmAmount]);

  useEffect(() => {
    if (step !== 3) return;
    fetchQuote();
  }, [step, fetchQuote]);

  // Countdown timer — ticks every second while the quote is live
  useEffect(() => {
    if (!lockedQuote || step !== 3) return;
    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((lockedQuote.expiresAt - Date.now()) / 1000),
      );
      setQuoteSecondsLeft(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [lockedQuote, step]);

  // Poll for transfer status when on the success step
  useEffect(() => {
    if (
      step !== 4 ||
      !transferReference ||
      transferStatus === 'success' ||
      transferStatus === 'failed' ||
      transferStatus === 'reversed'
    ) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/transfer-status/${transferReference}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.status) {
            setTransferStatus(json.data.status);
          }
        }
      } catch (err) {
        console.error('Error polling transfer status:', err);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [step, transferReference, transferStatus]);

  const filteredBanks = banks.filter((b) =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase()),
  );

  const handleVerifyAccount = useCallback(async () => {
    if (!accountNumber || !selectedBank) return;
    
    const validation = bankDetailsSchema.pick({ accountNumber: true }).safeParse({ accountNumber });
    if (!validation.success) {
      setVerifyError(validation.error.issues[0].message);
      return;
    }

    setVerifying(true);
    setVerifyError('');
    setVerifiedAccount(null);
    try {
      const res = await fetch('/api/verify-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber,
          bankCode: selectedBank.code,
        }),
      });
      const json: {
        success: boolean;
        data: VerifyAccountData;
        message?: string;
      } = await res.json();
      if (json.success) {
        setVerifiedAccount(json.data);
        chatTelemetry.fiatPayoutStep({
          action: 'account_verify_success',
          step: 2,
          xlmAmount,
        });
      } else {
        setVerifyError(json.message ?? 'Account verification failed');
        chatTelemetry.fiatPayoutStep({
          action: 'account_verify_fail',
          step: 2,
          xlmAmount,
          errorMessage: json.message ?? 'Account verification failed',
        });
      }
    } catch {
      setVerifyError('Account verification failed. Please try again.');
      chatTelemetry.fiatPayoutStep({
        action: 'account_verify_fail',
        step: 2,
        xlmAmount,
        errorMessage: 'network_error',
      });
    } finally {
      setVerifying(false);
    }
  }, [accountNumber, selectedBank]);

  const handleConfirmPayout = async () => {
    if (
      !selectedBank ||
      !verifiedAccount ||
      !lockedQuote ||
      quoteSecondsLeft === 0 ||
      isPayoutProcessing
    )
      return;

    const noteValidation = bankDetailsSchema.pick({ payoutNote: true }).safeParse({ payoutNote });
    if (!noteValidation.success) {
      setPayoutError(noteValidation.error.issues[0].message);
      return;
    }

    await executePayoutConfirm(async (idempotencyKey) => {
      chatTelemetry.fiatPayoutStep({
        action: 'confirm_attempt',
        step: 3,
        xlmAmount,
      });
      setPayoutLoading(true);
      setPayoutError('');
      setStatusEvents([]);
      pushStatusEvent('initiated', 'Transfer initiated');
      addNotification('payout_pending', 'Fiat payout request is pending...');
      try {
        // 1. Create Paystack transfer recipient
        const recipientRes = await fetch('/api/create-recipient', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            type: 'nuban',
            name: verifiedAccount.account_name,
            account_number: accountNumber,
            bank_code: selectedBank.code,
            currency: 'NGN',
          }),
        });
        const recipientJson: {
          success: boolean;
          data: CreateRecipientData;
          message?: string;
        } = await recipientRes.json();
        if (!recipientJson.success) {
          throw new Error(
            recipientJson.message ?? 'Failed to create transfer recipient',
          );
        }

        pushStatusEvent('pending', 'Submitted to bank — awaiting confirmation');
        setIsPollingStatus(true);

        // 2. Initiate the NGN bank transfer
        // The route handler multiplies the amount by 100 before calling Paystack,
        // so we send the NGN value directly (not kobo).
        const ngnValue = lockedQuote.ngnAmount;
        const transferRes = await fetch('/api/initiate-transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            source: 'balance',
            reason: `XLM to NGN - ${xlmAmount} XLM`,
            amount: ngnValue,
            recipient: recipientJson.data.recipient_code,
            clientSessionId: getOrCreateClientSessionId(),
          }),
        });
        const transferJson: {
          success: boolean;
          data: InitiateTransferData;
          message?: string;
        } = await transferRes.json();
        if (!transferJson.success) {
          throw new Error(
            transferJson.message ?? 'Failed to initiate bank transfer',
          );
        }

        setTransferReference(
          transferJson.data.reference || transferJson.data.transfer_code || '',
        );
        addEntry({
          kind: 'payout',
          status: 'pending',
          amount: String(xlmAmount),
          asset: 'XLM',
          fiatAmount: lockedQuote.ngnAmount.toLocaleString('en-NG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          fiatCurrency: 'NGN',
          note: payoutNote.trim() || undefined,
          reference:
            transferJson.data.reference ||
            transferJson.data.transfer_code ||
            '',
          message: `Fiat payout initiated to ${selectedBank.name}.`,
        });
        // Simulation block
        await new Promise((resolve) => setTimeout(resolve, 2500));
        setIsPollingStatus(false);
        pushStatusEvent('success', 'Bank transfer confirmed');
        setStep(4);
        chatTelemetry.fiatPayoutStep({
          action: 'confirm_success',
          step: 4,
          xlmAmount,
        });
        addNotification(
          'payout_success',
          'Fiat payout successfully completed!',
        );
      } catch (err) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : 'Payout failed. Please try again.';
        chatTelemetry.fiatPayoutStep({
          action: 'confirm_error',
          step: 3,
          xlmAmount,
          errorMessage: errorMsg,
        });
        setPayoutError(errorMsg);
        setIsPollingStatus(false);
        pushStatusEvent('failed', `Transfer failed: ${errorMsg}`);
        addNotification('payout_fail', `Payout failed: ${errorMsg}`);
      } finally {
        setPayoutLoading(false);
      }
    }, 'payout_confirm');
  };

  const handleClose = () => {
    chatTelemetry.fiatPayoutStep({ action: 'close', step, xlmAmount });
    // Reset all state before closing
    setStep(1);
    setBanks([]);
    setBanksLoading(false);
    setBanksError('');
    setBankSearch('');
    setSelectedBank(null);
    setAccountNumber('');
    setVerifying(false);
    setVerifyError('');
    setVerifiedAccount(null);
    setLockedQuote(null);
    setQuoteLoading(false);
    setQuoteSecondsLeft(120);
    setPayoutLoading(false);
    setPayoutError('');
    setPayoutNote('');
    setTransferReference('');
    setTransferStatus('pending');
    onClose();
  };

  const handleSelectSavedBeneficiary = (beneficiary: Beneficiary) => {
    setSelectedSavedBeneficiary(beneficiary);
    const bank = banks.find((b) => b.id === beneficiary.bankId);
    if (bank) {
      setSelectedBank(bank);
    }
    setAccountNumber(beneficiary.accountNumber);
    setVerifiedAccount({ account_name: beneficiary.accountName });
    setShowSavedBeneficiaries(false);
    setStep(3);
  };

  const handleStartRename = (beneficiary: Beneficiary) => {
    setEditingBeneficiaryId(beneficiary.id);
    setEditingName(beneficiary.name);
  };

  const handleSaveRename = (id: string) => {
    if (editingName.trim()) {
      renameBeneficiary(id, editingName.trim());
    }
    setEditingBeneficiaryId(null);
    setEditingName('');
  };

  const handleDeleteBeneficiary = (id: string) => {
    deleteBeneficiary(id);
    if (selectedSavedBeneficiary?.id === id) {
      setSelectedSavedBeneficiary(null);
    }
  };

  const handleSaveBeneficiary = () => {
    if (!selectedBank || !verifiedAccount) return;

    const validation = bankDetailsSchema.pick({ saveCustomName: true }).safeParse({ saveCustomName });
    if (!validation.success) {
      addNotification('payout_fail', validation.error.issues[0].message);
      return;
    }

    addBeneficiary(
      selectedBank.id,
      selectedBank.name,
      selectedBank.code,
      accountNumber,
      verifiedAccount.account_name,
      saveCustomName || undefined,
    );
    setShowSavePrompt(false);
    setSaveCustomName('');
  };

  useAccessibleModal(isOpen, modalRef, onClose);

  if (!isOpen) return null;

  return (
    <div className="theme-overlay fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Fiat payout"
        tabIndex={-1}
        className="theme-surface theme-border relative w-full max-w-md mx-4 border rounded-2xl shadow-2xl p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-400" />
            <h2 className="theme-text-primary text-lg font-semibold">
              Fiat Payout
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="theme-text-muted hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicators - hidden on the success screen */}
        {step < 4 && (
          <div className="flex items-center gap-1 mb-6">
            {([1, 2, 3] as const).map((s) => (
              <React.Fragment key={s}>
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    step === s
                      ? 'bg-blue-600 text-white'
                      : step > s
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {s}
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-0.5 ${step > s ? 'bg-green-500' : 'bg-gray-700'}`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Step 1: Bank Selection ── */}
        {step === 1 && (
          <div>
            {/* Saved Beneficiaries Toggle */}
            {beneficiariesLoaded && beneficiaries.length > 0 && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() =>
                    setShowSavedBeneficiaries(!showSavedBeneficiaries)
                  }
                  className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Star className="w-4 h-4" />
                  Use saved beneficiary ({beneficiaries.length})
                  <ChevronRight
                    className={`w-3 h-3 transition-transform ${showSavedBeneficiaries ? 'rotate-90' : ''}`}
                  />
                </button>

                {showSavedBeneficiaries && (
                  <div className="mt-2 max-h-40 overflow-y-auto space-y-1 pr-1">
                    {beneficiaries.map((beneficiary) => (
                      <div
                        key={beneficiary.id}
                        className="flex items-center gap-2 bg-gray-800 rounded-lg p-2"
                      >
                        {editingBeneficiaryId === beneficiary.id ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="flex-1 bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(beneficiary.id)}
                              className="p-1 text-green-400 hover:text-green-300"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingBeneficiaryId(null)}
                              className="p-1 text-gray-400 hover:text-gray-300"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                handleSelectSavedBeneficiary(beneficiary)
                              }
                              className="flex-1 text-left"
                            >
                              <p className="text-white text-sm font-medium">
                                {beneficiary.name}
                              </p>
                              <p className="text-gray-400 text-xs">
                                {beneficiary.bankName} ·{' '}
                                {beneficiary.accountNumber}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartRename(beneficiary)}
                              className="p-1 text-gray-400 hover:text-gray-300"
                              title="Rename"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteBeneficiary(beneficiary.id)
                              }
                              className="p-1 text-gray-400 hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-sm text-gray-400 mb-4">Select your bank</p>

            {banksLoading ? (
              <SkeletonWallet />
            ) : banksError ? (
              <div className="flex items-center gap-2 text-red-400 text-sm py-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{banksError}</span>
              </div>
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={bankSearch}
                    onChange={(e) => setBankSearch(e.target.value)}
                    placeholder="Search banks…"
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>

                <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                  {filteredBanks.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">
                      No banks found
                    </p>
                  ) : (
                    filteredBanks.map((bank) => (
                      <button
                        key={bank.id}
                        type="button"
                        onClick={() => {
                          setSelectedBank(bank);
                          chatTelemetry.fiatPayoutStep({
                            action: 'bank_selected',
                            step: 1,
                            xlmAmount,
                            bankCode: bank.code,
                          });
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          selectedBank?.id === bank.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        {bank.name}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedBank}
              className="mt-4 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white py-3 rounded-lg font-medium transition-colors"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Account Details ── */}
        {step === 2 && (
          <div>
            <p className="text-sm text-gray-400 mb-1">
              Bank:{' '}
              <span className="text-white font-medium">
                {selectedBank?.name}
              </span>
            </p>
            <p className="text-sm text-gray-400 mb-4">
              Enter your account number
            </p>

            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">
                Account Number
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => {
                  setAccountNumber(e.target.value);
                  setVerifiedAccount(null);
                  setVerifyError('');
                }}
                onBlur={handleVerifyAccount}
                maxLength={10}
                placeholder="0000000000"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {verifying && (
              <div className="flex items-center gap-2 text-blue-400 text-sm mb-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying account…</span>
              </div>
            )}

            {verifyError && !verifying && (
              <div className="flex items-center gap-2 text-red-400 text-sm mb-3 bg-red-400/10 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{verifyError}</span>
              </div>
            )}

            {verifiedAccount && !verifying && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-400 text-sm mb-3 bg-green-400/10 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>
                    Account name:{' '}
                    <strong>{verifiedAccount.account_name}</strong>
                  </span>
                </div>

                {/* Save beneficiary prompt */}
                {!showSavePrompt && (
                  <button
                    type="button"
                    onClick={() => setShowSavePrompt(true)}
                    className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Save beneficiary for future use
                  </button>
                )}

                {showSavePrompt && (
                  <div className="bg-gray-800 rounded-lg p-3 space-y-2">
                    <label className="block text-xs text-gray-400">
                      Beneficiary name (optional)
                    </label>
                    <input
                      type="text"
                      value={saveCustomName}
                      onChange={(e) => setSaveCustomName(e.target.value)}
                      placeholder={verifiedAccount.account_name}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveBeneficiary}
                        className="flex-1 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 rounded-lg transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSavePrompt(false);
                          setSaveCustomName('');
                        }}
                        className="px-3 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={!verifiedAccount}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white py-3 rounded-lg font-medium transition-colors"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Confirm Payout ── */}
        {step === 3 && (
          <div>
            <p className="theme-text-secondary text-sm mb-4">
              Review your payout details
            </p>

            <div className="theme-surface-muted theme-border rounded-xl border p-4 space-y-3 mb-4">
              <div className="flex justify-between text-sm">
                <span className="theme-text-secondary">XLM deposited</span>
                <span className="theme-text-primary font-medium">
                  {xlmAmount} XLM
                </span>
              </div>

              <div className="flex justify-between text-sm items-center">
                <span className="theme-text-secondary">Estimated NGN</span>
                {quoteLoading ? (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                ) : lockedQuote !== null ? (
                  <span className="theme-text-primary font-medium">
                    ₦
                    {lockedQuote.ngnAmount.toLocaleString('en-NG', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : (
                  <span className="theme-text-muted">-</span>
                )}
              </div>

              {/* Quote lock countdown */}
              {lockedQuote && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="theme-text-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Quote locked
                  </span>
                  {quoteSecondsLeft > 0 ? (
                    <span
                      className={`font-mono font-medium tabular-nums ${
                        quoteSecondsLeft > 30
                          ? 'text-green-400'
                          : quoteSecondsLeft > 10
                            ? 'text-yellow-400'
                            : 'text-red-400'
                      }`}
                    >
                      {String(Math.floor(quoteSecondsLeft / 60)).padStart(
                        2,
                        '0',
                      )}
                      :{String(quoteSecondsLeft % 60).padStart(2, '0')}
                    </span>
                  ) : (
                    <span className="text-red-400 font-medium">Expired</span>
                  )}
                </div>
              )}

              <div className="theme-border border-t pt-3 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="theme-text-secondary">Bank</span>
                  <span className="theme-text-primary font-medium">
                    {selectedBank?.name}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="theme-text-secondary">Account name</span>
                  <span className="theme-text-primary font-medium">
                    {verifiedAccount?.account_name}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="theme-text-secondary">Account number</span>
                  <span className="theme-text-primary font-medium font-mono">
                    {accountNumber}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="theme-text-secondary block text-sm mb-1">
                Optional payout note
              </label>
              <textarea
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
                placeholder="Add a note for this payout"
                rows={2}
                maxLength={160}
                className="theme-input w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            {/* Quote expiry warning */}
            {lockedQuote && quoteSecondsLeft === 0 && (
              <div className="flex items-center justify-between gap-2 text-red-400 text-sm mb-4 bg-red-400/10 rounded-lg px-3 py-2 border border-red-400/30">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Quote expired. Refresh to continue.</span>
                </div>
                <button
                  type="button"
                  onClick={fetchQuote}
                  disabled={quoteLoading}
                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 whitespace-nowrap disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${quoteLoading ? 'animate-spin' : ''}`}
                  />
                  Refresh
                </button>
              </div>
            )}

            {payoutError && (
              <div className="theme-soft-danger flex items-center gap-2 text-sm mb-4 rounded-lg px-3 py-2 border">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{payoutError}</span>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={payoutLoading}
                className="theme-secondary-button flex-1 disabled:opacity-50 py-3 rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmPayout}
                disabled={
                  payoutLoading ||
                  isPayoutProcessing ||
                  quoteLoading ||
                  !lockedQuote ||
                  quoteSecondsLeft === 0
                }
                className="theme-primary-button flex-1 flex items-center justify-center gap-2 disabled:bg-blue-800 disabled:opacity-70 text-white py-3 rounded-lg font-medium transition-colors"
              >
                {payoutLoading || isPayoutProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  'Confirm Payout'
                )}
              </button>
            </div>

            {/* Payout Status Timeline — visible while processing */}
            {statusEvents.length > 0 && (
              <div className="mt-6">
                <p className="theme-text-muted text-xs font-semibold uppercase tracking-wider mb-3">
                  Transfer Status
                </p>
                <TransferTimeline
                  events={statusEvents.map((event) => ({
                    ...event,
                    copyValue: transferReference || undefined,
                  }))}
                  isPolling={isPollingStatus}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Success ── */}
        {step === 4 && (
          <div className="text-center py-4">
            {transferStatus === 'success' ? (
              <CheckCircle className="w-14 h-14 text-green-400 mx-auto mb-4" />
            ) : transferStatus === 'failed' || transferStatus === 'reversed' ? (
              <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
            ) : (
              <Loader2 className="w-14 h-14 text-blue-400 mx-auto mb-4 animate-spin" />
            )}

            <p className="text-white font-semibold text-lg mb-2 capitalize">
              {transferStatus === 'pending'
                ? 'Processing Payout...'
                : transferStatus === 'success'
                  ? 'Payout Successful!'
                  : 'Payout Failed'}
            </p>
            <p className="text-gray-400 text-sm mb-6">
              {transferStatus === 'pending'
                ? 'Your bank transfer is processing. This usually takes a few minutes.'
                : transferStatus === 'success'
                  ? 'The funds have been successfully sent to your bank account.'
                  : 'There was an issue processing your bank transfer. Please contact support.'}
            </p>
            {payoutNote && (
              <p className="theme-text-secondary text-xs mb-6">
                Note: <span className="theme-text-primary">{payoutNote}</span>
              </p>
            )}

            {transferReference && (
              <div className="theme-surface-muted rounded-lg px-4 py-3 mb-6 text-left">
                <p className="theme-text-muted text-xs mb-1">
                  Transfer Reference
                </p>
                <div className="flex items-center gap-1.5">
                  <p className="theme-text-primary font-mono text-sm break-all">
                    {transferReference}
                  </p>
                  <CopyButton value={transferReference} />
                </div>
              </div>
            )}

            {/* Timeline showing all status transitions */}
            {statusEvents.length > 0 && (
              <div className="mb-6 text-left">
                <p className="theme-text-muted text-xs font-semibold uppercase tracking-wider mb-3">
                  Transfer History
                </p>
                <TransferTimeline
                  events={statusEvents.map((event) => ({
                    ...event,
                    copyValue: transferReference || undefined,
                  }))}
                  isPolling={false}
                />
              </div>
            )}

            {/* Cancel Payout Button within 2 mins */}
            {transferReference &&
              !statusEvents.some((e) => e.status === 'cancelled') && (
                <div className="mb-6">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(
                          `/api/transfer-status/${transferReference}`,
                          { method: 'POST' },
                        );
                        const json = await res.json();
                        if (json.success) {
                          pushStatusEvent('cancelled', 'Transfer cancelled');
                          addNotification(
                            'payout_cancelled',
                            'Payout was cancelled successfully.',
                          );
                        }
                      } catch (err) {
                        console.error('Cancel error:', err);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 py-3 rounded-lg font-medium transition-colors border border-red-500/20"
                  >
                    <X className="w-4 h-4" /> Cancel Payout
                  </button>
                </div>
              )}

            <button
              type="button"
              onClick={handleClose}
              className="theme-primary-button w-full py-3 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
