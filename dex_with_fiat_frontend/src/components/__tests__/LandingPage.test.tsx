import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LandingPage from '@/components/LandingPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    toggleDarkMode: vi.fn(),
  }),
}));

vi.mock('@/components/OfflineStatusBanner', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/CopyButton', () => ({
  default: () => <button type="button">Copy</button>,
}));

describe('LandingPage – accessibility', () => {
  afterEach(cleanup);

  it('wraps primary content in a labeled main landmark', () => {
    render(<LandingPage />);
    expect(screen.getByRole('main', { name: /DexFiat product overview/i })).toBeDefined();
  });

  it('associates the early-access email field with a label', () => {
    render(<LandingPage />);
    expect(screen.getByLabelText(/email address for early access/i)).toBeDefined();
  });

  it('labels the Stellar Expert external link for screen readers', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('link', { name: /View Stellar Testnet on Stellar Expert/i }),
    ).toBeDefined();
  });

  it('labels footer social links', () => {
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: /DexFiat on Twitter/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /DexFiat on GitHub/i })).toBeDefined();
  });
});
