'use client';

import { useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  SUPPORTED_FIAT_CURRENCIES,
  FiatCurrencyCode,
  useUserPreferences,
} from '@/contexts/UserPreferencesContext';

interface UserSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UserSettings({ isOpen, onClose }: UserSettingsProps) {
  const { isDarkMode } = useTheme();
  const { fiatCurrency, setFiatCurrency } = useUserPreferences();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Focus trap: move focus into panel on open
  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelect = (code: FiatCurrencyCode) => {
    setFiatCurrency(code);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="User settings"
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-80 flex flex-col shadow-2xl focus:outline-none transition-colors duration-300 ${
          isDarkMode ? 'bg-gray-900 border-l border-gray-700' : 'bg-white border-l border-gray-200'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${
            isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <h2
            className={`text-base font-semibold ${
              isDarkMode ? 'text-gray-100' : 'text-gray-900'
            }`}
          >
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className={`p-1.5 rounded-lg transition-colors ${
              isDarkMode
                ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          {/* Currency section */}
          <section>
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Default fiat currency
            </h3>
            <p
              className={`text-xs mb-4 ${
                isDarkMode ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              All quotes and conversion estimates will be displayed in this
              currency.
            </p>

            <ul role="listbox" aria-label="Select default fiat currency" className="space-y-1">
              {SUPPORTED_FIAT_CURRENCIES.map(({ code, label, symbol }) => {
                const isSelected = fiatCurrency === code;
                return (
                  <li key={code}>
                    <button
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(code)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm transition-all duration-150 ${
                        isSelected
                          ? isDarkMode
                            ? 'bg-blue-900/40 border border-blue-500/60 text-blue-300'
                            : 'bg-blue-50 border border-blue-300 text-blue-700'
                          : isDarkMode
                            ? 'border border-transparent hover:bg-gray-800 text-gray-300'
                            : 'border border-transparent hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`w-7 text-center font-mono font-semibold text-xs ${
                            isSelected
                              ? isDarkMode
                                ? 'text-blue-300'
                                : 'text-blue-600'
                              : isDarkMode
                                ? 'text-gray-400'
                                : 'text-gray-500'
                          }`}
                        >
                          {symbol}
                        </span>
                        <span>{label}</span>
                      </span>

                      {isSelected && (
                        <Check
                          className={`w-4 h-4 shrink-0 ${
                            isDarkMode ? 'text-blue-400' : 'text-blue-600'
                          }`}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
