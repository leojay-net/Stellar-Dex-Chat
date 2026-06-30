'use client';

import React, { useEffect, useState } from 'react';
import { z } from 'zod';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';
import LandingPage from '@/components/LandingPage';

/** Zod schema for validating a Stellar public key (56-char G-prefixed string). */
export const stellarAddressSchema = z.string().length(56).startsWith('G');

/** Inferred TypeScript type for a validated Stellar address. */
export type StellarAddress = z.infer<typeof stellarAddressSchema>;

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * High-order component to guard admin routes.
 * Checks if the connected wallet address matches the admin address in the smart contract.
 */
export default function AdminGuard({ children }: AdminGuardProps) {
  const { connection } = useStellarWallet();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAdmin() {
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
    }

    checkAdmin();
  }, [connection.address]);

  if (loading) {
    return (
      <div className="theme-app flex h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4"
          style={{
            borderColor: 'var(--color-border)',
            borderTopColor: 'var(--color-primary)',
          }}
        />
        <span className="theme-text-secondary ml-3 font-medium">Verifying admin access...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="theme-app flex h-screen flex-col items-center justify-center p-6 text-center">
        <div className="mb-4" style={{ color: 'var(--color-danger)' }}>
          <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
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
    return (
      <LandingPage />
    );
  }

  return <>{children}</>;
}
