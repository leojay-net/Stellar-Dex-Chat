'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';
import LandingPage from '@/components/LandingPage';

const stellarAddressSchema = z.string().length(56).startsWith('G');

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * High-order component to guard admin routes.
 *
 * @param children - The components to render if authentication passes.
 *
 * @example
 * ```tsx
 * <AdminGuard>
 *   <AdminDashboard />
 * </AdminGuard>
 * ```
 *
 * Architecture:
 * 1. **Session Check**: Verifies if a Stellar wallet is currently connected via `useStellarWallet`.
 * 2. **Blockchain Veracity**: Fetches the authorized admin address directly from the on-chain smart contract
 *    using the `getAdmin()` helper. This bypasses local storage or session variables that could be tampered with.
 * 3. **Identity Comparison**: Compares the connected `G...` address against the contract's reported admin.
 * 4. **Offline Retry Queue**: When the network is unavailable the check is queued and automatically
 *    retried as soon as the browser comes back online, so admins are never permanently locked out
 *    by a transient connectivity loss.
 * 5. **Conditional Rendering**:
 *    - If match: Renders `children`.
 *    - If mismatch or no wallet: Redirects to `LandingPage`.
 *    - If error: Displays a recovery UI with "Try Again" option.
 *    - If offline with queued retry: Displays an offline banner.
 *
 * This implementation ensures that administrative privileges are strictly tied to the on-chain state,
 * providing a robust security layer against front-end spoofing.
 */
export default function AdminGuard({ children }: AdminGuardProps) {
  const { connection } = useStellarWallet();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [retryQueued, setRetryQueued] = useState(false);

  // Stable ref so the online handler can call the latest checkAdmin without a
  // stale closure, even if connection.address changes between renders.
  const checkAdminRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const checkAdmin = useCallback(async () => {
    if (!navigator.onLine) {
      setRetryQueued(true);
      setLoading(false);
      return;
    }

    setRetryQueued(false);
    setLoading(true);
    setError(null);

    if (!connection.address) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const connectedParsed = stellarAddressSchema.safeParse(connection.address);
    if (!connectedParsed.success) {
      console.error('Invalid connected wallet address format:', connectedParsed.error);
      setError('Invalid wallet address format. Access denied.');
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    try {
      const adminAddress = await getAdmin();
      const adminParsed = stellarAddressSchema.safeParse(adminAddress);
      if (!adminParsed.success) {
        console.error('Invalid admin address configured in contract:', adminParsed.error);
        setError('Invalid contract configuration. Access denied.');
        setIsAdmin(false);
        return;
      }

      setIsAdmin(connectedParsed.data === adminParsed.data);
    } catch (err) {
      console.error('Failed to verify admin status:', err);
      setError('Failed to verify admin status. Please try again.');
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }, [connection.address]);

  // Keep the ref in sync so the online handler always calls the latest version.
  checkAdminRef.current = checkAdmin;

  // Run admin check whenever the connected address changes.
  useEffect(() => {
    checkAdmin();
  }, [checkAdmin]);

  // #490: Scroll to top smoothly whenever admin access is granted so the
  // dashboard renders from the top of the page, not wherever the user
  // navigated from. Only fires when loading completes and access is confirmed.
  useEffect(() => {
    if (!loading && isAdmin) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [loading, isAdmin]);

  // Attach online/offline listeners once.
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Flush the queue: retry the admin check that was skipped while offline.
      checkAdminRef.current?.();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (retryQueued && !isOnline) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[var(--color-surface)] p-6 text-center">
        <svg
          className="mx-auto mb-4 h-12 w-12"
          style={{ color: 'var(--color-text-muted)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M6.343 6.343a9 9 0 000 12.728m2.829-2.829a5 5 0 000-7.07"
          />
        </svg>
        <h2
          className="mb-2 text-xl font-bold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          You are offline
        </h2>
        <p
          className="text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Admin verification will retry automatically when your connection is restored.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-primary)]">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4"
          style={{
            borderColor: 'var(--color-primary)',
            borderTopColor: 'transparent',
          }}
        ></div>
        <span className="ml-3 font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Verifying admin access...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-primary)] p-6 text-center"
      >
        <div className="mb-4" style={{ color: 'var(--color-danger)' }}>
          <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {error}
        </h2>
        <button
          onClick={() => window.location.reload()}
          className="theme-primary-button rounded-lg px-4 py-2 text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <LandingPage />
    );
  }

  return <>{children}</>;
}
