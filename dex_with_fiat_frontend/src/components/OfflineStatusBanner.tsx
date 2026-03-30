'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';

/**
 * Offline Status Banner Component
 * Shows when the user loses internet connection
 * Displays accessibility-compliant live region
 */
export default function OfflineStatusBanner() {
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const { addToast } = useToast();
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setShowBanner(true);
    } else if (wasOffline && isOnline) {
      // Show toast when coming back online
      addToast({
        message: 'Your connection has been restored. Queued messages will be sent.',
        severity: 'success',
        durationMs: 3000,
      });
      setShowBanner(false);
      resetWasOffline();
    }
  }, [isOnline, wasOffline, addToast, resetWasOffline]);

  if (!showBanner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-0 left-0 right-0 z-50 bg-red-50 dark:bg-red-900/20 border-b-2 border-red-500 shadow-md"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <div className="shrink-0">
          <WifiOff className="w-5 h-5 text-red-600 dark:text-red-400 animate-pulse" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            You are offline. Messages will be sent when you reconnect.
          </p>
        </div>
        <div className="shrink-0 text-red-600 dark:text-red-400">
          <AlertTriangle className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}
