'use client';

import { useEffect, useRef } from 'react';

interface WalletConnectionTimelineProps {
  isConnected: boolean;
  isNetworkMismatch: boolean;
  isConnecting: boolean;
  /** When true, the wallet disconnected while a transfer was active. */
  transferInProgress?: boolean;
  contextMode?: 'simple' | 'advanced';
  onRetry?: () => void;
  /** Called once when the wallet drops while transferInProgress is true. */
  onDisconnectMidTransfer?: () => void;
}

type TimelineStep = {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'error';
  detail?: string;
};

export default function WalletConnectionTimeline({
  isConnected,
  isNetworkMismatch,
  isConnecting,
  transferInProgress = false,
  contextMode = 'simple',
  onRetry,
  onDisconnectMidTransfer,
}: WalletConnectionTimelineProps) {
  // Detect wallet drop mid-transfer: was connected on the previous render,
  // now disconnected while a transfer was still active.
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;

    if (wasConnected && !isConnected && transferInProgress) {
      onDisconnectMidTransfer?.();
    }
  }, [isConnected, transferInProgress, onDisconnectMidTransfer]);

  // Defensive guard: treat any falsy prop values as their safe defaults so the
  // component never throws even if a parent passes null/undefined.
  const connected = Boolean(isConnected);
  const mismatch = Boolean(isNetworkMismatch);
  const connecting = Boolean(isConnecting);
  const midTransferDisconnect = !connected && transferInProgress;

  const steps: TimelineStep[] = [
    {
      id: 'connect',
      label: 'Connect wallet',
      status: midTransferDisconnect
        ? 'error'
        : connected
          ? 'done'
          : connecting
            ? 'active'
            : 'pending',
      detail: midTransferDisconnect ? 'Wallet disconnected during transfer' : undefined,
    },
    {
      id: 'sign',
      label: 'Sign session',
      status: midTransferDisconnect
        ? 'error'
        : connected
          ? 'done'
          : connecting
            ? 'active'
            : 'pending',
    },
    {
      id: 'verify',
      label: 'Verify network',
      status: midTransferDisconnect
        ? 'pending'
        : connected && mismatch
          ? 'error'
          : connected
            ? 'done'
            : 'pending',
    },
    {
      id: 'ready',
      label: 'Ready',
      status: connected && !mismatch && !midTransferDisconnect ? 'done' : 'pending',
    },
  ];

  const visibleSteps = contextMode === 'advanced' ? steps : steps.slice(0, 3);

  return (
    <div className="theme-surface-muted theme-border mt-2 rounded-xl border px-3 py-2">
      <div className="theme-text-muted mb-2 text-[10px] font-bold uppercase tracking-widest">
        Wallet connection timeline
      </div>

      {midTransferDisconnect && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
        >
          Wallet disconnected mid-transfer. Please reconnect and retry.
        </div>
      )}

      <ol className="space-y-2" aria-label="Wallet connection timeline">
        {visibleSteps.map((step) => (
          <li key={step.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                  step.status === 'done'
                    ? 'bg-green-500'
                    : step.status === 'active'
                      ? 'animate-pulse bg-blue-500'
                      : step.status === 'error'
                        ? 'bg-red-500'
                        : 'bg-gray-500'
                }`}
              />
              <span className="theme-text-secondary">{step.label}</span>
            </div>
            {step.detail && (
              <p className="pl-[18px] text-[10px] text-red-500 dark:text-red-400">
                {step.detail}
              </p>
            )}
          </li>
        ))}
      </ol>

      {(mismatch || midTransferDisconnect) && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 w-full rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
        >
          Retry wallet connection
        </button>
      )}
    </div>
  );
}
