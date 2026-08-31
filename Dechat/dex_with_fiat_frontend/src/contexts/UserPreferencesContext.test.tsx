import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserPreferencesProvider, useUserPreferences } from './UserPreferencesContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <UserPreferencesProvider>{children}</UserPreferencesProvider>;
}

describe('UserPreferencesContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults every exposed value when nothing is saved', () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });

    expect(result.current.fiatCurrency).toBe('usd');
    expect(result.current.currencySymbol).toBe('$');
    expect(result.current.remindersEnabled).toBe(false);
    expect(result.current.reminderFrequency).toBe('weekly');
    expect(result.current.maskingEnabled).toBe(false);
    expect(result.current.maskingStyle).toBe('asterisk');
    expect(result.current.highValueThreshold).toBe(500);
    expect(result.current.twoFactorEnabled).toBe(true);
  });

  describe('restoring from localStorage', () => {
    it('picks up a valid saved currency', () => {
      localStorage.setItem('fiat-currency', 'eur');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.fiatCurrency).toBe('eur');
      expect(result.current.currencySymbol).toBe('€');
    });

    it('ignores an unsupported saved currency', () => {
      localStorage.setItem('fiat-currency', 'zzz');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.fiatCurrency).toBe('usd');
    });

    it('picks up saved reminders / frequency', () => {
      localStorage.setItem('reminders-enabled', 'true');
      localStorage.setItem('reminder-frequency', 'monthly');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.remindersEnabled).toBe(true);
      expect(result.current.reminderFrequency).toBe('monthly');
    });

    it('ignores an invalid saved reminder frequency', () => {
      localStorage.setItem('reminder-frequency', 'daily');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.reminderFrequency).toBe('weekly');
    });

    it('picks up a valid saved masking style', () => {
      localStorage.setItem('content-masking-enabled', 'true');
      localStorage.setItem('content-masking-style', 'block');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.maskingEnabled).toBe(true);
      expect(result.current.maskingStyle).toBe('block');
    });

    it('ignores an invalid saved masking style', () => {
      localStorage.setItem('content-masking-style', 'not-a-style');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.maskingStyle).toBe('asterisk');
    });

    it('picks up a valid saved high-value threshold', () => {
      localStorage.setItem('high-value-threshold', '1000');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.highValueThreshold).toBe(1000);
    });

    it('ignores a non-numeric or non-positive saved threshold', () => {
      localStorage.setItem('high-value-threshold', 'not-a-number');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.highValueThreshold).toBe(500);
    });

    it('picks up a saved two-factor preference', () => {
      localStorage.setItem('two-factor-enabled', 'false');

      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      expect(result.current.twoFactorEnabled).toBe(false);
    });
  });

  describe('setters', () => {
    it('setFiatCurrency updates state, symbol, and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setFiatCurrency('gbp');
      });

      expect(result.current.fiatCurrency).toBe('gbp');
      expect(result.current.currencySymbol).toBe('£');
      expect(localStorage.getItem('fiat-currency')).toBe('gbp');
    });

    it('setRemindersEnabled updates state and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setRemindersEnabled(true);
      });

      expect(result.current.remindersEnabled).toBe(true);
      expect(localStorage.getItem('reminders-enabled')).toBe('true');
    });

    it('setReminderFrequency updates state and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setReminderFrequency('monthly');
      });

      expect(result.current.reminderFrequency).toBe('monthly');
      expect(localStorage.getItem('reminder-frequency')).toBe('monthly');
    });

    it('setMaskingEnabled updates state and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setMaskingEnabled(true);
      });

      expect(result.current.maskingEnabled).toBe(true);
      expect(localStorage.getItem('content-masking-enabled')).toBe('true');
    });

    it('setMaskingStyle updates state and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setMaskingStyle('pipe');
      });

      expect(result.current.maskingStyle).toBe('pipe');
      expect(localStorage.getItem('content-masking-style')).toBe('pipe');
    });

    it('setHighValueThreshold updates state and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setHighValueThreshold(2000);
      });

      expect(result.current.highValueThreshold).toBe(2000);
      expect(localStorage.getItem('high-value-threshold')).toBe('2000');
    });

    it('setTwoFactorEnabled updates state and storage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });

      act(() => {
        result.current.setTwoFactorEnabled(false);
      });

      expect(result.current.twoFactorEnabled).toBe(false);
      expect(localStorage.getItem('two-factor-enabled')).toBe('false');
    });
  });

  it('throws a clear error when consumed outside the provider', () => {
    expect(() => renderHook(() => useUserPreferences())).toThrow(
      'useUserPreferences must be used within UserPreferencesProvider',
    );
  });
});
