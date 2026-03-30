'use client';

import { ReactNode } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { StellarWalletProvider } from '@/contexts/StellarWalletContext';
import { UserPreferencesProvider } from '@/contexts/UserPreferencesContext';
import { TranslationProvider } from '@/contexts/TranslationContext';
import { ToastProvider } from '@/components/ToastProvider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <TranslationProvider>
      <ThemeProvider>
        <UserPreferencesProvider>
          <StellarWalletProvider>
            <ToastProvider>{children}</ToastProvider>
          </StellarWalletProvider>
        </UserPreferencesProvider>
      </ThemeProvider>
    </TranslationProvider>
  );
}
