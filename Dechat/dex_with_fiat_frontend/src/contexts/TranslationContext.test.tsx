import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TranslationProvider, useTranslation } from './TranslationContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <TranslationProvider>{children}</TranslationProvider>;
}

describe('TranslationContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to English when nothing is saved and the browser locale is unsupported', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });

    expect(result.current.locale).toBe('en');
    expect(result.current.t('common.retry')).toBe('Retry');
  });

  it('restores a previously saved locale from localStorage', () => {
    localStorage.setItem('locale', 'fr');

    const { result } = renderHook(() => useTranslation(), { wrapper });

    expect(result.current.locale).toBe('fr');
  });

  it('ignores an unsupported saved locale and falls back to detection/default', () => {
    localStorage.setItem('locale', 'de');

    const { result } = renderHook(() => useTranslation(), { wrapper });

    expect(result.current.locale).toBe('en');
  });

  it('setLocale updates state and persists the new locale', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });

    act(() => {
      result.current.setLocale('es');
    });

    expect(result.current.locale).toBe('es');
    expect(localStorage.getItem('locale')).toBe('es');

    act(() => {
      result.current.setLocale('en');
    });

    expect(result.current.locale).toBe('en');
    expect(localStorage.getItem('locale')).toBe('en');
  });

  it('t() resolves nested keys for the active locale', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });

    act(() => {
      result.current.setLocale('fr');
    });

    expect(result.current.t('common.retry')).not.toBe('common.retry');
  });

  it('t() falls back to English when a key is missing from a non-English locale', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });

    act(() => {
      result.current.setLocale('fr');
    });

    // A key that is very unlikely to exist in any locale file.
    expect(result.current.t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('t() interpolates params into the resolved string', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper });

    const output = result.current.t('common.network_mismatch_warning', {
      expectedNetwork: 'Testnet',
    });

    // The template contains "{expectedNetwork}" twice; interpolation replaces
    // at least the first occurrence with the supplied value.
    expect(output).toContain('Testnet');
    expect(output).not.toBe(
      result.current.t('common.network_mismatch_warning'),
    );
  });

  it('throws a clear error when consumed outside the provider', () => {
    expect(() => renderHook(() => useTranslation())).toThrow(
      'useTranslation must be used within a TranslationProvider',
    );
  });
});
