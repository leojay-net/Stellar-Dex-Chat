'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';
import {
  buildCCIPExplorerTransactionUrl,
  CCIP_POLL_INTERVAL_MS,
  CCIP_POLL_TIMEOUT_MS,
  type CCIPStatusResult,
  type CCIPTransferStartResult,
} from '@/lib/ccipExplorer';

type BridgeState = 'idle' | 'optimistic' | 'initiating' | 'polling' | 'success' | 'error';

export interface CCIPBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTransfer: () => Promise<CCIPTransferStartResult>;
  fetchTransferStatus: (transactionHash: string) => Promise<CCIPStatusResult>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /**
   * Currently selected network identifier (chain ID or name).
   * When this value changes the modal immediately invalidates any in-progress
   * fee estimate or polling state so stale data from the previous network is
   * never shown to the user.
   */
  network?: string | number;
}

export default function CCIPBridgeModal({
  isOpen,
  onClose,
  onStartTransfer,
  fetchTransferStatus,
  pollIntervalMs = CCIP_POLL_INTERVAL_MS,
  timeoutMs = CCIP_POLL_TIMEOUT_MS,
  network,
}: CCIPBridgeModalProps) {
  const dialogTitleId = 'ccip-bridge-modal-title';
  const dialogDescriptionId = 'ccip-bridge-modal-description';
  const modalRef = useRef<HTMLDivElement>(null);
  const pollingStartedAtRef = useRef<number | null>(null);
  // Fix #520: keep a ref in sync with transactionHash state so the polling
  // callback always reads the latest value without being re-created on every
  // hash change (avoids stale-closure race condition).
  const transactionHashRef = useRef('');
  const [bridgeState, setBridgeState] = useState<BridgeState>('idle');
  const [transactionHash, setTransactionHash] = useState('');
  const [explorerUrl, setExplorerUrl] = useState('');
  const [latestStatus, setLatestStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState('');
  const [networkChangedWhileActive, setNetworkChangedWhileActive] = useState(false);
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const { addToast } = useToast();
  const wasOnlineRef = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isOpen) {
      wasOnlineRef.current = isOnline;
      return;
    }

    const prevOnline = wasOnlineRef.current;

    if (prevOnline && !isOnline) {
      addToast({
        message: "You're offline. CCIP transfer status may not update until you reconnect.",
        severity: 'warning',
        durationMs: 4500,
      });
    } else if (!prevOnline && isOnline && wasOffline) {
      addToast({
        message: 'Back online. CCIP transfer status will refresh with the latest data.',
        severity: 'success',
        durationMs: 3000,
      });
      resetWasOffline();
    }

    wasOnlineRef.current = isOnline;
  }, [isOpen, isOnline, wasOffline, addToast, resetWasOffline]);

  // #1179: single sr-only live region announcing bridge state transitions.
  // The visible per-state sections below aren't in an aria-live container,
  // so a screen reader user starting a transfer would hear nothing as it
  // moves through optimistic -> initiating -> polling -> success/error.
  const bridgeAnnouncement = useMemo(() => {
    switch (bridgeState) {
      case 'optimistic':
        return 'Transfer initiated. Preparing transaction.';
      case 'initiating':
        return 'Starting CCIP transfer.';
      case 'polling':
        return latestStatus
          ? `Waiting for CCIP confirmation. Latest status: ${latestStatus}.`
          : 'Waiting for CCIP confirmation.';
      case 'success':
        return `CCIP transfer confirmed. Status: ${latestStatus || 'SUCCESS'}.`;
      case 'error':
        return `CCIP transfer error. ${errorMessage}`;
      default:
        return '';
    }
  }, [bridgeState, latestStatus, errorMessage]);

  // Keep ref in sync with state.
  // Keep ref in sync with state.
  useEffect(() => {
    transactionHashRef.current = transactionHash;
  }, [transactionHash]);

  useAccessibleModal(isOpen, modalRef, onClose);

  const resetState = useCallback(() => {
    pollingStartedAtRef.current = null;
    transactionHashRef.current = '';
    setBridgeState('idle');
    setTransactionHash('');
    setExplorerUrl('');
    setLatestStatus('');
    setErrorMessage('');
    setNetworkChangedWhileActive(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // Fix #954: immediately invalidate in-progress state when the network changes
  // so the stale fee estimate / polling result from the previous network is never
  // visible to the user.  Skip the very first render (network undefined → value).
  const prevNetworkRef = useRef(network);
  useEffect(() => {
    const prev = prevNetworkRef.current;
    prevNetworkRef.current = network;

    // Only act if the network actually changed (not just on first mount).
    if (prev === undefined || prev === network) return;

    if (bridgeState !== 'idle' && bridgeState !== 'success') {
      // Reset fee/status display immediately; keep bridgeState readable so
      // we can show the "network changed" notice.
      setLatestStatus('');
      setExplorerUrl('');
      setNetworkChangedWhileActive(true);
      // Abort any outstanding polling by resetting to idle.
      pollingStartedAtRef.current = null;
      transactionHashRef.current = '';
      setBridgeState('idle');
      setTransactionHash('');
      setErrorMessage('');
    }
  }, [network, bridgeState]);

  const handleStartTransfer = useCallback(async () => {
    // Immediately show optimistic UI
    setBridgeState('optimistic');
    setErrorMessage('');

    // Optimistic UI update: immediately show pending state
    setLatestStatus('PENDING');

    try {
      const result = await onStartTransfer();
      const nextHash = result.transactionHash.trim();

      if (!nextHash) {
        throw new Error('CCIP transfer did not return a transaction hash.');
      }

      pollingStartedAtRef.current = Date.now();
      transactionHashRef.current = nextHash;
      setTransactionHash(nextHash);

      // Optimistic UI: set explorer URL immediately for better UX
      const explorerUrlValue = result.explorerUrl ?? buildCCIPExplorerTransactionUrl(nextHash);
      setExplorerUrl(explorerUrlValue);

      // Transition to polling state now that we have a hash
      setBridgeState('polling');
    } catch (error) {
      // Rollback optimistic updates on error
      setLatestStatus('');
      setBridgeState('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start the CCIP transfer.',
      );
    }
  }, [onStartTransfer]);

  // Fix #520: pollTransferStatus reads the hash from a ref instead of closing
  // over the state value.  This means the callback identity is stable and the
  // polling interval never fires with a stale hash.
  const pollTransferStatus = useCallback(async (signal: { aborted: boolean }) => {
    const hash = transactionHashRef.current;
    if (!hash) return;

    const pollingStartedAt = pollingStartedAtRef.current;
    const hasTimedOut =
      pollingStartedAt !== null &&
      Date.now() - pollingStartedAt >= timeoutMs;

    if (hasTimedOut) {
      signal.aborted = true;
      setBridgeState('error');
      setErrorMessage(
        'CCIP confirmation timed out after 10 minutes. Please verify the transaction in the explorer and try again.',
      );
      return;
    }

    try {
      const result = await fetchTransferStatus(hash);
      if (signal.aborted) return;

      if (
        pollingStartedAtRef.current !== null &&
        Date.now() - pollingStartedAtRef.current >= timeoutMs
      ) {
        signal.aborted = true;
        setBridgeState('error');
        setErrorMessage(
          'CCIP confirmation timed out after 10 minutes. Please verify the transaction in the explorer and try again.',
        );
        return;
      }

      // Optimistic UI: update status immediately
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

      if (signal.aborted) return;
      setBridgeState('polling');
    } catch (error) {
      if (signal.aborted) return;
      const startedAt = pollingStartedAtRef.current;
      if (
        startedAt !== null &&
        Date.now() - startedAt >= timeoutMs
      ) {
        signal.aborted = true;
        setBridgeState('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'CCIP confirmation timed out after 10 minutes.',
        );
        return;
      }
      // Maintain PENDING status during transient errors
      setLatestStatus('PENDING');
      setBridgeState('polling');
    }
  }, [fetchTransferStatus, timeoutMs]);

  useEffect(() => {
    if (
      !isOpen ||
      !transactionHash ||
      bridgeState !== 'polling'
    ) {
      return;
    }

    // Fix #520: each effect invocation gets its own abort signal so that
    // in-flight async calls from a previous render cycle cannot mutate state
    // after the effect has been cleaned up.
    const signal = { aborted: false };

    void pollTransferStatus(signal);
    const intervalId = window.setInterval(() => {
      void pollTransferStatus(signal);
    }, pollIntervalMs);

    return () => {
      signal.aborted = true;
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
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabIndex={-1}
        className="theme-surface theme-border relative w-full max-w-md mx-4 border rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              id={dialogTitleId}
              className="theme-text-primary text-lg font-semibold"
            >
              CCIP Bridge
            </h2>
            <p
              id={dialogDescriptionId}
              className="theme-text-secondary text-sm mt-1"
            >
              Start a CCIP transfer and monitor its confirmation state.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close CCIP bridge dialog"
            className="theme-text-muted hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {bridgeAnnouncement}
        </div>

        {networkChangedWhileActive && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            Network changed — fee estimate cleared. Start a new transfer on the
            current network.
          </div>
        )}

        {bridgeState === 'idle' && (
          <button
            type="button"
            onClick={() => {
              setNetworkChangedWhileActive(false);
              void handleStartTransfer();
            }}
            aria-label="Start CCIP transfer"
            className="theme-primary-button w-full py-3 rounded-lg font-medium"
          >
            Start CCIP Transfer
          </button>
        )}

        {bridgeState === 'optimistic' && (
          <div className="text-center py-6">
            <div className="w-14 h-14 bg-blue-500 rounded-full mx-auto mb-4 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            <p className="theme-text-primary font-semibold text-lg mb-2">
              Transfer Initiated!
            </p>
            <p className="theme-text-secondary text-sm mb-4">
              Processing your CCIP transfer request...
            </p>
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="theme-text-secondary text-xs">
                Preparing transaction
              </span>
            </div>
          </div>
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
              aria-label="CCIP transfer confirmation in progress"
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
                <span className="sr-only">Transaction hash: </span>
                <span aria-hidden>Transaction: </span>{transactionHash}
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
                <ExternalLink className="w-4 h-4" aria-hidden />
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
            {transactionHash && (
              <p className="theme-text-secondary text-xs mb-4 break-all">
                <span className="sr-only">Transaction hash: </span>
                <span aria-hidden>Transaction: </span>{transactionHash}
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
                <ExternalLink className="w-4 h-4" aria-hidden />
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
            {transactionHash && (
              <p className="theme-text-secondary text-xs mb-4 break-all">
                <span className="sr-only">Transaction hash: </span>
                <span aria-hidden>Transaction: </span>{transactionHash}
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
                <ExternalLink className="w-4 h-4" aria-hidden />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
