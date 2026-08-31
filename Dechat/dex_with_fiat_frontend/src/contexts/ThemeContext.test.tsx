import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light mode when nothing is saved', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.isDarkMode).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('restores dark mode from a saved preference', () => {
    localStorage.setItem('theme', 'dark');

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.isDarkMode).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggleDarkMode flips state, DOM attribute, and persisted value', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.toggleDarkMode();
    });

    expect(result.current.isDarkMode).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    act(() => {
      result.current.toggleDarkMode();
    });

    expect(result.current.isDarkMode).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('throws a clear error when consumed outside the provider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      'useTheme must be used within a ThemeProvider',
    );
  });
});
