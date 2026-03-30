'use client';

import React, { useEffect, useState } from 'react';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';
import LandingPage from '@/components/LandingPage';

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

      try {
        const adminAddress = await getAdmin();
        setIsAdmin(connection.address === adminAddress);
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
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-white border-white/20"></div>
        <span className="ml-3 font-medium">Verifying admin access...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-900 text-white p-6 text-center">
        <div className="mb-4 text-red-500">
          <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2">{error}</h2>
        <button 
          onClick={() => window.location.reload()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700"
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
