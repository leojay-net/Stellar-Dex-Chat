'use client';

import { useEffect, useState, useRef } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';
import { offlineStatusToastSchema } from '@/lib/offlineStatusSchema';
import { subscribeToQueuedMessageCount } from '@/lib/offlineMessageQueue';

/**
 * Offline Status Banner Component
 * Shows when the user loses internet connection
 * Displays accessibility-compliant live region
 * Implements optimistic UI updates for immediate feedback
 */
export default function OfflineStatusBanner() {
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const { addToast } = useToast();
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [optimisticPendingCount, setOptimisticPendingCount] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const previousOnlineState = useRef<boolean>(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  // The queue count is owned by `offlineMessageQueue` and published by
  // `useChat` as sends are queued and drained; this component only mirrors it.
  useEffect(() => {
    return subscribeToQueuedMessageCount(setOptimisticPendingCount);
  }, []);

  useEffect(() => {
    // A reconnect is either observed live (we saw the offline render) or
    // reported after the fact by `wasOffline` — the latter happens when this
    // banner mounts only once the connection is already back. Without the
    // `wasOffline` arm the toast is skipped and the latch is never reset, so
    // the hook keeps reporting a reconnect that was never announced.
    const cameBackOnline = isOnline && (!previousOnlineState.current || wasOffline);

    // Optimistic UI: Show banner immediately when going offline
    if (!isOnline && previousOnlineState.current) {
      setShowBanner(true);
      setIsReconnecting(false);
    }
    // Optimistic UI: Hide banner immediately when coming back online
    else if (cameBackOnline) {
      setIsReconnecting(true);
      // Show toast when coming back online
      const toastOptions = {
        message:
          'Your connection has been restored. Queued messages will be sent.',
        severity: 'success',
        durationMs: 3000,
      };

      // Validate toast options with Zod
      const result = offlineStatusToastSchema.safeParse(toastOptions);

      if (result.success) {
        addToast(result.data);
      } else {
        const errorMessage =
          result.error.issues[0]?.message || 'Connection restored';
        console.error(
          'OfflineStatusBanner: Invalid toast options',
          result.error.format(),
        );
        addToast(errorMessage);
      }

      // Consume the latch straight away, so the reconnect is announced exactly
      // once rather than on every subsequent render.
      resetWasOffline();

      // Optimistically hide banner after short delay
      setTimeout(() => {
        setShowBanner(false);
        setIsReconnecting(false);
      }, 500);
    }

    previousOnlineState.current = isOnline;
  }, [isOnline, wasOffline, addToast, resetWasOffline]);

  if (isLoading && isOnline) {
    return (
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 z-50 border-b-2 shadow-md bg-[var(--color-surface)] border-[var(--color-border)]"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-5 h-5 rounded bg-[var(--color-surface-muted)] animate-pulse" />
          <div className="flex-1 h-4 rounded bg-[var(--color-surface-muted)] animate-pulse" />
          <div className="w-5 h-5 rounded bg-[var(--color-surface-muted)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!showBanner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={isReconnecting ? "Reconnecting" : "Offline status"}
      className={`fixed top-0 left-0 right-0 z-50 border-b-2 shadow-md transition-all duration-300 ${
        isReconnecting 
          ? 'bg-[var(--color-success)] border-[color-mix(in_srgb,var(--color-success)_80%,black)]' 
          : 'bg-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_80%,black)]'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <div className="shrink-0" aria-hidden="true">
          {isReconnecting ? (
            <WifiOff className="w-5 h-5 text-white" />
          ) : (
            <WifiOff className="w-5 h-5 animate-pulse text-white" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            {isReconnecting 
              ? 'Reconnecting...' 
              : 'You are offline. Messages will be sent when you reconnect.'}
          </p>
          {optimisticPendingCount > 0 && (
            <p className="text-xs text-white/90 mt-0.5">
              {optimisticPendingCount} message{optimisticPendingCount === 1 ? '' : 's'} waiting to
              send
            </p>
          )}
        </div>
        <div className="shrink-0" aria-hidden="true">
          <AlertTriangle className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}
