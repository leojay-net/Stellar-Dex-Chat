'use client';

import type { MaskingStyle } from '@/lib/textMasking';
import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'fiat-currency';
const REMINDERS_ENABLED_KEY = 'reminders-enabled';
const REMINDER_FREQUENCY_KEY = 'reminder-frequency';
const MASKING_ENABLED_KEY = 'content-masking-enabled';
const MASKING_STYLE_KEY = 'content-masking-style';
const DEFAULT_CURRENCY = 'usd';

export const SUPPORTED_FIAT_CURRENCIES = [
  { code: 'usd', label: 'USD — US Dollar', symbol: '$' },
  { code: 'eur', label: 'EUR — Euro', symbol: '€' },
  { code: 'gbp', label: 'GBP — British Pound', symbol: '£' },
  { code: 'ngn', label: 'NGN — Nigerian Naira', symbol: '₦' },
  { code: 'cad', label: 'CAD — Canadian Dollar', symbol: 'CA$' },
  { code: 'aud', label: 'AUD — Australian Dollar', symbol: 'A$' },
  { code: 'jpy', label: 'JPY — Japanese Yen', symbol: '¥' },
] as const;

export type FiatCurrencyCode =
  (typeof SUPPORTED_FIAT_CURRENCIES)[number]['code'];

interface UserPreferencesContextType {
  fiatCurrency: FiatCurrencyCode;
  setFiatCurrency: (currency: FiatCurrencyCode) => void;
  currencySymbol: string;
  remindersEnabled: boolean;
  setRemindersEnabled: (enabled: boolean) => void;
  reminderFrequency: 'weekly' | 'monthly';
  setReminderFrequency: (frequency: 'weekly' | 'monthly') => void;
  maskingEnabled: boolean;
  setMaskingEnabled: (enabled: boolean) => void;
  maskingStyle: MaskingStyle;
  setMaskingStyle: (style: MaskingStyle) => void;
}

const UserPreferencesContext = createContext<
  UserPreferencesContextType | undefined
>(undefined);

export function UserPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fiatCurrencyState, setFiatCurrencyState] = useState<FiatCurrencyCode>(DEFAULT_CURRENCY);
  const [remindersEnabledState, setRemindersEnabledState] = useState(false);
  const [reminderFrequencyState, setReminderFrequencyState] = useState<'weekly' | 'monthly'>('weekly');
  const [maskingEnabledState, setMaskingEnabledState] = useState(false);
  const [maskingStyleState, setMaskingStyleState] = useState<MaskingStyle>('asterisk');

  // Restore saved preferences on mount
  useEffect(() => {
    const savedCurrency = localStorage.getItem(
      STORAGE_KEY,
    ) as FiatCurrencyCode | null;
    if (
      savedCurrency &&
      SUPPORTED_FIAT_CURRENCIES.some((c) => c.code === savedCurrency)
    ) {
      setFiatCurrencyState(savedCurrency);
    }

    const savedReminders = localStorage.getItem(REMINDERS_ENABLED_KEY);
    if (savedReminders !== null) {
      setRemindersEnabledState(savedReminders === 'true');
    }

    const savedFrequency = localStorage.getItem(REMINDER_FREQUENCY_KEY) as
      | 'weekly'
      | 'monthly'
      | null;
    if (savedFrequency === 'weekly' || savedFrequency === 'monthly') {
      setReminderFrequencyState(savedFrequency);
    }

    const savedMasking = localStorage.getItem(MASKING_ENABLED_KEY);
    if (savedMasking !== null) {
      setMaskingEnabledState(savedMasking === 'true');
    }

    const savedMaskingStyle = localStorage.getItem(MASKING_STYLE_KEY) as MaskingStyle | null;
    if (savedMaskingStyle && ['asterisk', 'block', 'initial', 'pipe'].includes(savedMaskingStyle)) {
      setMaskingStyleState(savedMaskingStyle as MaskingStyle);
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

  const setMaskingEnabled = (enabled: boolean) => {
    setMaskingEnabledState(enabled);
    localStorage.setItem(MASKING_ENABLED_KEY, String(enabled));
  };

  const setMaskingStyle = (style: MaskingStyle) => {
    setMaskingStyleState(style);
    localStorage.setItem(MASKING_STYLE_KEY, style);
  };

  const currencySymbol =
    SUPPORTED_FIAT_CURRENCIES.find((c) => c.code === fiatCurrencyState)?.symbol ?? '$';

  return (
    <UserPreferencesContext.Provider
      value={{
        fiatCurrency: fiatCurrencyState,
        setFiatCurrency,
        currencySymbol,
        remindersEnabled: remindersEnabledState,
        setRemindersEnabled,
        reminderFrequency: reminderFrequencyState,
        setReminderFrequency,
        maskingEnabled: maskingEnabledState,
        setMaskingEnabled,
        maskingStyle: maskingStyleState,
        setMaskingStyle,
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  );
}

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error('useUserPreferences must be used within UserPreferencesProvider');
  }
  return context;
};
