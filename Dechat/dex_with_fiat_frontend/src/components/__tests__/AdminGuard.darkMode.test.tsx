import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminGuard from '../AdminGuard';
import { ThemeContext } from '@/contexts/ThemeContext';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';

vi.mock('@/contexts/StellarWalletContext');
vi.mock('@/lib/stellarContract');
vi.mock('@/components/LandingPage', () => ({
  default: () => <div data-testid="landing-page">Landing Page</div>,
}));

const VALID_ADDR = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';

function mockSystemPrefersDark(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Keeps the guard in its loading state by never resolving the admin lookup. */
function renderLoading(
  wrapper?: React.ComponentType<{ children: React.ReactNode }>,
) {
  vi.mocked(useStellarWallet).mockReturnValue({
    connection: { address: VALID_ADDR },
  } as any);
  vi.mocked(getAdmin).mockReturnValue(new Promise(() => {}));

  return render(
    <AdminGuard>
      <div>Secret content</div>
    </AdminGuard>,
    wrapper ? { wrapper } : undefined,
  );
}

function themeWrapper(isDarkMode: boolean) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode: vi.fn() }}>
        {children}
      </ThemeContext.Provider>
    );
  };
}

describe('AdminGuard dark mode fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    mockSystemPrefersDark(false);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders without a ThemeProvider and defaults to light', () => {
    renderLoading();

    const loading = screen.getByTestId('admin-guard-loading');
    expect(loading).toHaveAttribute('data-theme', 'light');
    expect(loading.style.colorScheme).toBe('light');
  });

  it('falls back to prefers-color-scheme when no theme is applied yet', () => {
    mockSystemPrefersDark(true);
    renderLoading();

    const loading = screen.getByTestId('admin-guard-loading');
    expect(loading).toHaveAttribute('data-theme', 'dark');
    expect(loading.style.colorScheme).toBe('dark');
  });

  it('uses ThemeContext over the system preference when a provider is mounted', () => {
    mockSystemPrefersDark(true);
    renderLoading(themeWrapper(false));

    expect(screen.getByTestId('admin-guard-loading')).toHaveAttribute(
      'data-theme',
      'light',
    );
  });

  it('follows a dark ThemeContext', () => {
    renderLoading(themeWrapper(true));

    expect(screen.getByTestId('admin-guard-loading')).toHaveAttribute(
      'data-theme',
      'dark',
    );
  });

  it('prefers the data-theme attribute on <html> over context and system', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderLoading(themeWrapper(false));

    expect(screen.getByTestId('admin-guard-loading')).toHaveAttribute(
      'data-theme',
      'dark',
    );
  });

  it('reacts when data-theme on <html> changes after mount', async () => {
    renderLoading();
    expect(screen.getByTestId('admin-guard-loading')).toHaveAttribute(
      'data-theme',
      'light',
    );

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    expect(screen.getByTestId('admin-guard-loading')).toHaveAttribute(
      'data-theme',
      'dark',
    );
  });

  it('applies the fallback scheme to the error screen', async () => {
    mockSystemPrefersDark(true);
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: 'not-a-stellar-address' },
    } as any);

    render(
      <AdminGuard>
        <div>Secret content</div>
      </AdminGuard>,
    );

    const errorScreen = await screen.findByTestId('admin-guard-error');
    expect(errorScreen).toHaveAttribute('data-theme', 'dark');
    expect(errorScreen.style.colorScheme).toBe('dark');
  });
});
