'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Resolves the active colour scheme for components that render outside the
 * normal theme tree (e.g. full-screen overlays).
 *
 * Priority: ThemeContext → `data-theme` on `<html>` → `prefers-color-scheme`.
 */
export function useEffectiveDarkMode(): boolean {
  const { isDarkMode } = useTheme();
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);

    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  if (typeof document !== 'undefined') {
    const dataTheme = document.documentElement.getAttribute('data-theme');
    if (dataTheme === 'dark') return true;
    if (dataTheme === 'light') return false;
  }

  return isDarkMode || systemPrefersDark;
}
