'use client';

import { useEffect, useState, useCallback } from 'react';
import { chatTelemetry } from '@/lib/chatTelemetry';

// Probe the app to confirm that a browser online event restored connectivity.
async function verifyConnectivity(
  controller: AbortController,
): Promise<boolean> {
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
      chatTelemetry.networkStatus({
        status: window.navigator.onLine ? 'online' : 'offline',
        source: 'initial',
      });
    }

    let activeProbe: AbortController | undefined;

    const checkOnline = async () => {
      activeProbe?.abort();
      const controller = new AbortController();
      activeProbe = controller;
      const hasConnectivity = await verifyConnectivity(controller);
      if (activeProbe !== controller) return;
      activeProbe = undefined;
      setIsOnline(hasConnectivity);
      if (hasConnectivity) {
        setWasOffline(true);
      }
    };

    const handleOnline = () => {
      void checkOnline();
    };

    const cancelProbe = () => {
      activeProbe?.abort();
      activeProbe = undefined;
    };

    const handleOffline = () => {
      cancelProbe();
      setIsOnline(false);
      setWasOffline(true);
      chatTelemetry.networkStatus({
        status: 'offline',
        source: 'browser-event',
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        cancelProbe();
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
