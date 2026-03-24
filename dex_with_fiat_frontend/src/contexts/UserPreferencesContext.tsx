'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'fiat-currency';
const DEFAULT_CURRENCY = 'usd';

export const SUPPORTED_FIAT_CURRENCIES = [
  { code: 'usd', label: 'USD — US Dollar',        symbol: '$'   },
  { code: 'eur', label: 'EUR — Euro',              symbol: '€'   },
  { code: 'gbp', label: 'GBP — British Pound',     symbol: '£'   },
  { code: 'ngn', label: 'NGN — Nigerian Naira',    symbol: '₦'   },
  { code: 'cad', label: 'CAD — Canadian Dollar',   symbol: 'CA$' },
  { code: 'aud', label: 'AUD — Australian Dollar', symbol: 'A$'  },
  { code: 'jpy', label: 'JPY — Japanese Yen',      symbol: '¥'   },
] as const;

export type FiatCurrencyCode = (typeof SUPPORTED_FIAT_CURRENCIES)[number]['code'];

interface UserPreferencesContextType {
  fiatCurrency: FiatCurrencyCode;
  setFiatCurrency: (currency: FiatCurrencyCode) => void;
  currencySymbol: string;
}

const UserPreferencesContext = createContext<UserPreferencesContextType | undefined>(
  undefined,
);

export function UserPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fiatCurrency, setFiatCurrencyState] =
    useState<FiatCurrencyCode>(DEFAULT_CURRENCY);

  // Restore saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as FiatCurrencyCode | null;
    if (saved && SUPPORTED_FIAT_CURRENCIES.some((c) => c.code === saved)) {
      setFiatCurrencyState(saved);
    }
  }, []);

  const setFiatCurrency = (currency: FiatCurrencyCode) => {
    setFiatCurrencyState(currency);
    localStorage.setItem(STORAGE_KEY, currency);
  };

  const currencySymbol =
    SUPPORTED_FIAT_CURRENCIES.find((c) => c.code === fiatCurrency)?.symbol ?? '$';

  return (
    <UserPreferencesContext.Provider
      value={{ fiatCurrency, setFiatCurrency, currencySymbol }}
    >
      {children}
    </UserPreferencesContext.Provider>
  );
}

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error(
      'useUserPreferences must be used within a UserPreferencesProvider',
    );
  }
  return context;
};
