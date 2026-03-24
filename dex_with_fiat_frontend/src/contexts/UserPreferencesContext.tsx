'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'fiat-currency';
const REMINDERS_ENABLED_KEY = 'reminders-enabled';
const REMINDER_FREQUENCY_KEY = 'reminder-frequency';
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
  remindersEnabled: boolean;
  setRemindersEnabled: (enabled: boolean) => void;
  reminderFrequency: 'weekly' | 'monthly';
  setReminderFrequency: (frequency: 'weekly' | 'monthly') => void;
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
  const [remindersEnabled, setRemindersEnabledState] = useState(false);
  const [reminderFrequency, setReminderFrequencyState] = useState<'weekly' | 'monthly'>('weekly');

  // Restore saved preference on mount
  useEffect(() => {
    const savedCurrency = localStorage.getItem(STORAGE_KEY) as FiatCurrencyCode | null;
    if (savedCurrency && SUPPORTED_FIAT_CURRENCIES.some((c) => c.code === savedCurrency)) {
      setFiatCurrencyState(savedCurrency);
    }

    const savedReminders = localStorage.getItem(REMINDERS_ENABLED_KEY);
    if (savedReminders !== null) {
      setRemindersEnabledState(savedReminders === 'true');
    }

    const savedFrequency = localStorage.getItem(REMINDER_FREQUENCY_KEY) as 'weekly' | 'monthly' | null;
    if (savedFrequency === 'weekly' || savedFrequency === 'monthly') {
      setReminderFrequencyState(savedFrequency);
    }
  }, []);

  const setFiatCurrency = (currency: FiatCurrencyCode) => {
    setFiatCurrencyState(currency);
    localStorage.setItem(STORAGE_KEY, currency);
  };

  const setRemindersEnabled = (enabled: boolean) => {
    setRemindersEnabledState(enabled);
    localStorage.setItem(REMINDERS_ENABLED_KEY, String(enabled));
  };

  const setReminderFrequency = (frequency: 'weekly' | 'monthly') => {
    setReminderFrequencyState(frequency);
    localStorage.setItem(REMINDER_FREQUENCY_KEY, frequency);
  };

  const currencySymbol =
    SUPPORTED_FIAT_CURRENCIES.find((c) => c.code === fiatCurrency)?.symbol ?? '$';

  return (
    <UserPreferencesContext.Provider
      value={{
        fiatCurrency,
        setFiatCurrency,
        currencySymbol,
        remindersEnabled,
        setRemindersEnabled,
        reminderFrequency,
        setReminderFrequency,
      }}
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
