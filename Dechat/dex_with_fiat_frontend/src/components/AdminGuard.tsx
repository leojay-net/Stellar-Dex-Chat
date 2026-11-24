'use client';

import React, { useContext, useEffect, useState } from 'react';
import { z } from 'zod';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';
import { signTransaction } from '@stellar/freighter-api';
import {
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Memo,
  Account,
} from '@stellar/stellar-sdk';
import LandingPage from '@/components/LandingPage';
import { ThemeContext } from '@/contexts/ThemeContext';

/** Zod schema for validating a Stellar public key (56-char G-prefixed string). */
export const stellarAddressSchema = z.string().length(56).startsWith('G');

/** Inferred TypeScript type for a validated Stellar address. */
export type StellarAddress = z.infer<typeof stellarAddressSchema>;

export type AdminGuardColorScheme = 'light' | 'dark';

/**
 * Resolves the colour scheme for the guard's own full-screen states.
 *
 * The guard can render before `ThemeProvider` has applied the saved theme to
 * `<html>`, or outside a provider entirely, so it cannot rely on the global
 * `[data-theme]` selector alone. Priority: `data-theme` on `<html>` →
 * ThemeContext (when mounted) → `prefers-color-scheme`.
 */
export function useAdminGuardColorScheme(): AdminGuardColorScheme {
  const themeContext = useContext(ThemeContext);
  const [dataTheme, setDataTheme] = useState<string | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);

    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    setDataTheme(root.getAttribute('data-theme'));

    const observer = new MutationObserver(() => {
      setDataTheme(root.getAttribute('data-theme'));
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  if (dataTheme === 'dark' || dataTheme === 'light') return dataTheme;
  if (themeContext) return themeContext.isDarkMode ? 'dark' : 'light';
  return systemPrefersDark ? 'dark' : 'light';
}

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * High-order component to guard admin routes.
 * Checks if the connected wallet address matches the admin address in the smart contract
 * and establishes a server-verified session via nonce/signature flow.
 */
export default function AdminGuard({ children }: AdminGuardProps) {
  const { connection } = useStellarWallet();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const colorScheme = useAdminGuardColorScheme();

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      if (!connection.address) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const connectedParsed = stellarAddressSchema.safeParse(
        connection.address,
      );
      if (!connectedParsed.success) {
        console.error(
          'Invalid connected wallet address format:',
          connectedParsed.error,
        );
        setError('Invalid wallet address format. Access denied.');
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        const adminAddress = await getAdmin();
        const adminParsed = stellarAddressSchema.safeParse(adminAddress);
        if (!adminParsed.success) {
          console.error(
            'Invalid admin address configured in contract:',
            adminParsed.error,
          );
          setError('Invalid contract configuration. Access denied.');
          setIsAdmin(false);
          return;
        }

        const isAddressMatch = connectedParsed.data === adminParsed.data;

        if (!isAddressMatch) {
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        // Address matches, now authenticate with server via nonce/signature
        setAuthenticating(true);

        // Request nonce from server
        const nonceResponse = await fetch('/api/admin/auth/nonce');
        if (!nonceResponse.ok) {
          throw new Error('Failed to request authentication nonce');
        }

        const { nonce } = await nonceResponse.json();
        if (cancelled) return;

        // Create a minimal transaction with the nonce as a memo hash
        // We need to fetch the account sequence first
        const accountResponse = await fetch(
          `${connection.network?.toUpperCase() === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org'}/accounts/${connection.address}`,
        );
        if (!accountResponse.ok) {
          throw new Error('Failed to fetch account details');
        }
        const accountData = await accountResponse.json();
        if (cancelled) return;

        const networkPassphrase =
          connection.networkPassphrase || Networks.TESTNET;
        const account = new Account(
          accountData.account_id,
          accountData.sequence,
        );

        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addMemo(Memo.hash(Buffer.from(nonce, 'base64')))
          .setTimeout(30)
          .build();

        const xdr = transaction.toXDR();

        // Sign the transaction with Freighter
        const signResult = await signTransaction(xdr, {
          networkPassphrase,
          address: connection.address,
        });
        if (cancelled) return;

        if (signResult.error) {
          throw new Error(`Failed to sign: ${signResult.error}`);
        }

        // Submit signature to server to establish session
        const authResponse = await fetch('/api/admin/auth/nonce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce,
            signature: signResult.signedTxXdr,
            address: connection.address,
          }),
        });

        if (cancelled) return;

        if (!authResponse.ok) {
          const errorData = await authResponse.json();
          throw new Error(errorData.error || 'Authentication failed');
        }

        if (!cancelled) setIsAdmin(true);
      } catch (err) {
        console.error('Failed to verify admin status:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to verify admin status. Please try again.',
        );
        setIsAdmin(false);
      } finally {
        setLoading(false);
        setAuthenticating(false);
      }
    }

    checkAdmin();

    return () => {
      cancelled = true;
    };
  }, [connection.address, connection.networkPassphrase, connection.network]);

  if (loading) {
    return (
      <div
        data-testid="admin-guard-loading"
        data-theme={colorScheme}
        style={{ colorScheme }}
        className="theme-app flex h-screen items-center justify-center"
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-4"
          style={{
            borderColor: 'var(--color-border)',
            borderTopColor: 'var(--color-primary)',
          }}
        />
        <span className="theme-text-secondary ml-3 font-medium">
          {authenticating
            ? 'Authenticating admin session...'
            : 'Verifying admin access...'}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="admin-guard-error"
        data-theme={colorScheme}
        style={{ colorScheme }}
        className="theme-app flex h-screen flex-col items-center justify-center p-6 text-center"
      >
        <div className="mb-4" style={{ color: 'var(--color-danger)' }}>
          <svg
            className="mx-auto h-12 w-12"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="theme-text-primary text-xl font-bold mb-2">{error}</h2>
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
    return <LandingPage />;
  }

  return <>{children}</>;
}
