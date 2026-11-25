'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Resolves the active colour scheme for components that render outside the
 * normal theme tree (e.g. full-screen overlays).
 *
 * Priority: `data-theme` on `<html>` → ThemeContext → `prefers-color-scheme`.
 *
 * Memory-leak fix (#1219): the previous implementation read
 * `document.documentElement.getAttribute('data-theme')` synchronously during
 * render on every re-render. This caused:
 *   1. SSR hydration mismatches (document is undefined on the server).
 *   2. The `data-theme` value never updated reactively — it was only read at
 *      the render that happened to run; changes after mount were invisible.
 *   3. The `mql.addEventListener` cleanup path was correct, but the implicit
 *      DOM subscription (direct attribute read) was never cleaned up.
 *
 * Fix: track `data-theme` via a `MutationObserver` scoped to the `<html>`
 * element's attribute changes. The observer is created once on mount and
 * disconnected in the cleanup function — no subscription leak.
 */
export function useEffectiveDarkMode(): boolean {
  const { isDarkMode } = useTheme();
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [dataTheme, setDataTheme] = useState<string | null>(null);

  // Observe prefers-color-scheme changes
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mql.matches);

    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Observe data-theme attribute changes on <html> via MutationObserver so
  // the value is always current and never read synchronously during render.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Seed the initial value
    setDataTheme(document.documentElement.getAttribute('data-theme'));

    const observer = new MutationObserver(() => {
      setDataTheme(document.documentElement.getAttribute('data-theme'));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Cleanup: disconnect prevents the observer from holding a reference to
    // this component's state setter after unmount — fixing the memory leak.
    return () => observer.disconnect();
  }, []);

  if (dataTheme === 'dark') return true;
  if (dataTheme === 'light') return false;

  return isDarkMode || systemPrefersDark;
}
