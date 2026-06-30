'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Verify actual internet connectivity by pinging a reliable endpoint.
 * Detects captive portals and other cases where navigator.onLine is misleading.
 */
async function verifyConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hook to track network online/offline status
 * Provides isOnline state and watchers for online/offline events
 *
 * Uses navigator.onLine as the primary indicator but also performs
 * real connectivity checks to detect captive portals and false positives.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [wasOffline, setWasOffline] = useState<boolean>(false);

  useEffect(() => {
    // Set initial state
    if (typeof window !== 'undefined') {
      setIsOnline(window.navigator.onLine);
    }

    const handleOnline = async () => {
      const hasConnectivity = await verifyConnectivity();
      setIsOnline(hasConnectivity);
      if (hasConnectivity) {
        setWasOffline(true);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  const resetWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  return {
    isOnline,
    wasOffline,
    resetWasOffline,
  };
}
