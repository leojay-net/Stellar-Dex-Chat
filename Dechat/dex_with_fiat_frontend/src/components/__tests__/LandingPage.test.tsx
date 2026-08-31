import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import LandingPage from '@/components/LandingPage';
import { useTheme } from '../../contexts/ThemeContext';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({
    isDarkMode: false,
    toggleDarkMode: vi.fn(),
  })),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
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

  it('labels each testimonial star rating for screen readers', () => {
    render(<LandingPage />);
    const ratings = screen.getAllByLabelText(/Rating: 5 out of 5 stars/i);
    expect(ratings.length).toBeGreaterThan(0);
  });

  it('hides decorative icons from assistive technology', () => {
    const { container } = render(<LandingPage />);
    const decorativeIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(decorativeIcons.length).toBeGreaterThan(0);
  });

  it('announces the early-access success message via a status role', () => {
    render(<LandingPage />);
    const emailInput = screen.getByLabelText(/email address for early access/i);
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    const submitButton = screen.getByRole('button', { name: /submit email and launch app/i });
    fireEvent.click(submitButton);
    expect(screen.getByRole('status')).toBeDefined();
  });
});

describe('LandingPage – keyboard shortcuts (#1185)', () => {
  afterEach(cleanup);

  it('navigates to /chat when "g" is pressed', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);

    render(<LandingPage />);
    fireEvent.keyDown(window, { key: 'g' });

    expect(push).toHaveBeenCalledWith('/chat');
  });

  it('toggles the theme when "d" is pressed', () => {
    const toggleDarkMode = vi.fn();
    vi.mocked(useTheme).mockReturnValue({ isDarkMode: false, toggleDarkMode });

    render(<LandingPage />);
    fireEvent.keyDown(window, { key: 'd' });

    expect(toggleDarkMode).toHaveBeenCalledTimes(1);
  });

  it('does not trigger the shortcut while typing in the email field', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);

    render(<LandingPage />);
    const emailInput = screen.getByLabelText(/email address for early access/i);
    fireEvent.keyDown(emailInput, { key: 'g' });

    expect(push).not.toHaveBeenCalled();
  });
});
