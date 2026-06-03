import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEffectiveDarkMode } from '../useEffectiveDarkMode';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isDarkMode: false, toggleDarkMode: vi.fn() })),
}));

describe('useEffectiveDarkMode', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers data-theme="dark" on the document element', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(true);
  });

  it('prefers data-theme="light" on the document element', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(false);
  });
});
