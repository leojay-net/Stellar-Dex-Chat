'use client';

import { ReactNode } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { StellarWalletProvider } from '@/contexts/StellarWalletContext';
import { UserPreferencesProvider } from '@/contexts/UserPreferencesContext';
import { ToastProvider } from './ToastProvider';

import { TranslationProvider } from '@/contexts/TranslationContext';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <UserPreferencesProvider>
        <TranslationProvider>
          <StellarWalletProvider>
            <ToastProvider>{children}</ToastProvider>
          </StellarWalletProvider>
        </TranslationProvider>
      </UserPreferencesProvider>
    </ThemeProvider>
  );
}

