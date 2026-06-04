'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';
import { offlineStatusToastSchema } from '@/lib/offlineStatusSchema';

/**
 * Offline Status Banner Component
 * Shows when the user loses internet connection
 * Displays accessibility-compliant live region
 */
export default function OfflineStatusBanner() {
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const { addToast } = useToast();
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isOnline) {
      setShowBanner(true);
    } else if (wasOffline && isOnline) {
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

      setShowBanner(false);
      resetWasOffline();
    }
  }, [isOnline, wasOffline, addToast, resetWasOffline]);

  if (isLoading) {
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
      aria-label="Offline status"
      className="fixed top-0 left-0 right-0 z-50 border-b-2 shadow-md bg-red-700 border-red-900"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <div className="shrink-0" aria-hidden="true">
          <WifiOff className="w-5 h-5 animate-pulse text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            You are offline. Messages will be sent when you reconnect.
          </p>
        </div>
        <div className="shrink-0" aria-hidden="true">
          <AlertTriangle className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}
