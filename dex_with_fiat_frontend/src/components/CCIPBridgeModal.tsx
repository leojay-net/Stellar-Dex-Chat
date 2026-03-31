'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import {
  buildCCIPExplorerTransactionUrl,
  CCIP_POLL_INTERVAL_MS,
  CCIP_POLL_TIMEOUT_MS,
  type CCIPStatusResult,
  type CCIPTransferStartResult,
} from '@/lib/ccipExplorer';

type BridgeState = 'idle' | 'initiating' | 'polling' | 'success' | 'error';

export interface CCIPBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTransfer: () => Promise<CCIPTransferStartResult>;
  fetchTransferStatus: (transactionHash: string) => Promise<CCIPStatusResult>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export default function CCIPBridgeModal({
  isOpen,
  onClose,
  onStartTransfer,
  fetchTransferStatus,
  pollIntervalMs = CCIP_POLL_INTERVAL_MS,
  timeoutMs = CCIP_POLL_TIMEOUT_MS,
}: CCIPBridgeModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const pollingStartedAtRef = useRef<number | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeState>('idle');
  const [transactionHash, setTransactionHash] = useState('');
  const [explorerUrl, setExplorerUrl] = useState('');
  const [latestStatus, setLatestStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState('');

  useAccessibleModal(isOpen, modalRef, onClose);

  const resetState = useCallback(() => {
    pollingStartedAtRef.current = null;
    setBridgeState('idle');
    setTransactionHash('');
    setExplorerUrl('');
    setLatestStatus('');
    setErrorMessage('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  const handleStartTransfer = useCallback(async () => {
    setBridgeState('initiating');
    setErrorMessage('');

    try {
      const result = await onStartTransfer();
      const nextHash = result.transactionHash.trim();

      if (!nextHash) {
        throw new Error('CCIP transfer did not return a transaction hash.');
      }

      pollingStartedAtRef.current = Date.now();
      setTransactionHash(nextHash);
      setExplorerUrl(
        result.explorerUrl ?? buildCCIPExplorerTransactionUrl(nextHash),
      );
      setLatestStatus('PENDING');
      setBridgeState('polling');
    } catch (error) {
      setBridgeState('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start the CCIP transfer.',
      );
    }
  }, [onStartTransfer]);

  const pollTransferStatus = useCallback(async () => {
    if (!transactionHash) {
      return;
    }

    const pollingStartedAt = pollingStartedAtRef.current;
    if (
      pollingStartedAt !== null &&
      Date.now() - pollingStartedAt >= timeoutMs
    ) {
      setBridgeState('error');
      setErrorMessage(
        'CCIP confirmation timed out after 10 minutes. Please verify the transaction in the explorer and try again.',
      );
      return;
    }

    try {
      const result = await fetchTransferStatus(transactionHash);
      setLatestStatus(result.status);
      if (result.explorerUrl) {
        setExplorerUrl(result.explorerUrl);
      }

      if (result.status === 'SUCCESS') {
        setBridgeState('success');
        return;
      }

      if (result.status === 'FAILED' || result.status === 'ERROR') {
        setBridgeState('error');
        setErrorMessage(
          result.errorMessage ??
            `CCIP transfer failed with status "${result.status}".`,
        );
        return;
      }

      setBridgeState('polling');
    } catch (error) {
      setLatestStatus('PENDING');
      setBridgeState('polling');
      if (
        pollingStartedAt !== null &&
        Date.now() - pollingStartedAt >= timeoutMs
      ) {
        setBridgeState('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'CCIP confirmation timed out after 10 minutes.',
        );
      }
    }
  }, [fetchTransferStatus, timeoutMs, transactionHash]);

  useEffect(() => {
    if (
      !isOpen ||
      !transactionHash ||
      bridgeState === 'idle' ||
      bridgeState === 'success' ||
      bridgeState === 'error'
    ) {
      return;
    }

    void pollTransferStatus();
    const intervalId = window.setInterval(() => {
      void pollTransferStatus();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    bridgeState,
    isOpen,
    pollIntervalMs,
    pollTransferStatus,
    transactionHash,
  ]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="theme-overlay fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="CCIP bridge transfer"
        tabIndex={-1}
        className="theme-surface theme-border relative w-full max-w-md mx-4 border rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="theme-text-primary text-lg font-semibold">
              CCIP Bridge
            </h2>
            <p className="theme-text-secondary text-sm mt-1">
              Start a CCIP transfer and monitor its confirmation state.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="theme-text-muted hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {bridgeState === 'idle' && (
          <button
            type="button"
            onClick={() => void handleStartTransfer()}
            className="theme-primary-button w-full py-3 rounded-lg font-medium"
          >
            Start CCIP Transfer
          </button>
        )}

        {bridgeState === 'initiating' && (
          <div className="flex items-center justify-center gap-3 py-10">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span className="theme-text-primary text-sm">
              Starting CCIP transfer…
            </span>
          </div>
        )}

        {bridgeState === 'polling' && (
          <div className="text-center py-6">
            <Loader2
              data-testid="ccip-polling-spinner"
              className="w-14 h-14 text-blue-400 mx-auto mb-4 animate-spin"
            />
            <p className="theme-text-primary font-semibold text-lg mb-2">
              Waiting for CCIP confirmation…
            </p>
            {latestStatus && (
              <p className="theme-text-secondary text-sm mb-4">
                Latest status: {latestStatus}
              </p>
            )}
            {transactionHash && (
              <p className="theme-text-secondary text-xs mb-4 break-all">
                Transaction: {transactionHash}
              </p>
            )}
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-blue-400 hover:underline text-sm"
              >
                View transaction in CCIP explorer
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}

        {bridgeState === 'success' && (
          <div className="text-center py-6">
            <CheckCircle
              data-testid="ccip-success-icon"
              className="w-14 h-14 text-green-500 mx-auto mb-4"
            />
            <p className="theme-text-primary font-semibold text-lg mb-2">
              CCIP transfer confirmed
            </p>
            <p className="theme-text-secondary text-sm mb-4">
              Status: {latestStatus || 'SUCCESS'}
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-blue-400 hover:underline text-sm"
              >
                View transaction in CCIP explorer
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}

        {bridgeState === 'error' && (
          <div className="text-center py-6">
            <AlertCircle className="w-14 h-14 text-red-500 mx-auto mb-4" />
            <p className="theme-text-primary font-semibold text-lg mb-2">
              CCIP transfer error
            </p>
            <p className="theme-text-secondary text-sm mb-4">
              {errorMessage}
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-blue-400 hover:underline text-sm"
              >
                View transaction in CCIP explorer
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
