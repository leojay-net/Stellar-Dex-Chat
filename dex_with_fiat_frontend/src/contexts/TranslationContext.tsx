'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import en from '../locales/en.json';

type TranslationKeys = typeof en;
type NestedKeyOf<T> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? `${K}.${NestedKeyOf<T[K]>}` : K }[keyof T & string]
  : never;

export type TKey = NestedKeyOf<TranslationKeys>;

interface TranslationContextType {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
  setLocale: (locale: string) => void;
}

const translations: Record<string, TranslationKeys> = { en };

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState('en');

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const keys = key.split('.');
    let value: unknown = translations[locale];
    
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
    }

    if (typeof value !== 'string') return key;

    if (params) {
      return Object.entries(params).reduce(
        (acc: string, [k, v]) => acc.replace(`{${k}}`, String(v)),
        value as string
      );
    }

    return value;
  }, [locale]);

  const value = useMemo(() => ({ t, locale, setLocale }), [t, locale]);

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslation must be used within a TranslationProvider');
  }
  return context;
}
