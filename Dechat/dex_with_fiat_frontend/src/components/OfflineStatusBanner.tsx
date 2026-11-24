'use client';

import { useEffect, useState, useRef } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';
import { offlineStatusToastSchema } from '@/lib/offlineStatusSchema';
import { subscribeToQueuedMessageCount } from '@/lib/offlineMessageQueue';

/** Gap left between the banner's bottom edge and a focused element scrolled clear of it. */
export const BANNER_SCROLL_MARGIN_PX = 8;

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
  const [pendingPage, setPendingPage] = useState(1);
  const PENDING_PAGE_SIZE = 5;
  const [isReconnecting, setIsReconnecting] = useState(false);
  const previousOnlineState = useRef<boolean>(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const hasPendingLine = optimisticPendingCount > 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  // The queue count is owned by `offlineMessageQueue` and published by
  // `useChat` as sends are queued and drained; this component only mirrors it.
  useEffect(() => {
    return subscribeToQueuedMessageCount((count) => {
      setOptimisticPendingCount(count);
    });
  }, []);

  useEffect(() => {
    // A reconnect is either observed live (we saw the offline render) or
    // reported after the fact by `wasOffline` — the latter happens when this
    // banner mounts only once the connection is already back. Without the
    // `wasOffline` arm the toast is skipped and the latch is never reset, so
    // the hook keeps reporting a reconnect that was never announced.
    const cameBackOnline =
      isOnline && (!previousOnlineState.current || wasOffline);

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
    }

    previousOnlineState.current = isOnline;
  }, [isOnline, wasOffline, addToast, resetWasOffline]);

  useEffect(() => {
    if (!isReconnecting) {
      return;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (optimisticPendingCount > 0) {
      setShowBanner(true);
      return;
    }

    reconnectTimerRef.current = setTimeout(() => {
      setShowBanner(false);
      setIsReconnecting(false);
    }, 500);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [isReconnecting, optimisticPendingCount]);

  // Auto-scroll: the banner is fixed over the top of the page, so reserve its
  // height as `scroll-padding-top` (keeps focus/anchor scrolling clear of it)
  // and nudge the focused element out from underneath when it gets covered.
  useEffect(() => {
    const banner = bannerRef.current;
    if (!showBanner || !banner || typeof document === 'undefined') return;

    const root = document.documentElement;
    const previousScrollPadding = root.style.scrollPaddingTop;
    const bannerHeight = banner.getBoundingClientRect().height;
    root.style.scrollPaddingTop = `${bannerHeight}px`;

    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !banner.contains(active)
    ) {
      const rect = active.getBoundingClientRect();
      // Only elements that are on screen and under the banner; never yank the
      // page back to something the user has already scrolled away from.
      if (rect.bottom > 0 && rect.top < bannerHeight) {
        const prefersReducedMotion =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollBy({
          top: rect.top - bannerHeight - BANNER_SCROLL_MARGIN_PX,
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        });
      }
    }

    return () => {
      root.style.scrollPaddingTop = previousScrollPadding;
    };
  }, [showBanner, isReconnecting, hasPendingLine]);

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
      ref={bannerRef}
      data-testid="offline-status-banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={isReconnecting ? 'Reconnecting' : 'Offline status'}
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
          {optimisticPendingCount > 0 &&
            (() => {
              const totalPages = Math.ceil(
                optimisticPendingCount / PENDING_PAGE_SIZE,
              );
              const safePage = Math.min(pendingPage, totalPages);
              const start = (safePage - 1) * PENDING_PAGE_SIZE + 1;
              const end = Math.min(
                safePage * PENDING_PAGE_SIZE,
                optimisticPendingCount,
              );
              return (
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-white/90">
                    Showing {start}–{end} of {optimisticPendingCount} message
                    {optimisticPendingCount === 1 ? '' : 's'} waiting to send
                  </p>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        disabled={safePage <= 1}
                        onClick={() =>
                          setPendingPage((p) => Math.max(1, p - 1))
                        }
                        className="text-xs text-white/80 disabled:opacity-40 hover:text-white px-1"
                        aria-label="Previous page of queued messages"
                      >
                        ‹
                      </button>
                      <span className="text-xs text-white/80">
                        {safePage}/{totalPages}
                      </span>
                      <button
                        disabled={safePage >= totalPages}
                        onClick={() =>
                          setPendingPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="text-xs text-white/80 disabled:opacity-40 hover:text-white px-1"
                        aria-label="Next page of queued messages"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
        </div>
        <div className="shrink-0" aria-hidden="true">
          <AlertTriangle className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}
