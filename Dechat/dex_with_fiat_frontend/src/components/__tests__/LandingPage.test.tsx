import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  render as renderComponent,
  screen,
  cleanup,
  fireEvent,
} from '@testing-library/react';
import { useRouter } from 'next/navigation';
import LandingPage from '@/components/LandingPage';
import { UserPreferencesProvider } from '@/contexts/UserPreferencesContext';
import { useTheme } from '../../contexts/ThemeContext';
import { CONTRACT_ID } from '@/lib/stellarContract';

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

const render = (element: React.ReactElement) =>
  renderComponent(element, { wrapper: UserPreferencesProvider });

describe('LandingPage – accessibility', () => {
  afterEach(cleanup);

  it('wraps primary content in a labeled main landmark', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('main', { name: /DexFiat product overview/i }),
    ).toBeDefined();
  });

  it('labels the Stellar Expert external link for screen readers', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('link', {
        name: /View Stellar Testnet on Stellar Expert/i,
      }),
    ).toBeDefined();
  });

  it('labels footer social links', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('link', { name: /DexFiat on Twitter/i }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: /DexFiat on GitHub/i }),
    ).toBeDefined();
  });

  it('labels each testimonial star rating for screen readers', () => {
    render(<LandingPage />);
    const ratings = screen.getAllByLabelText(/Rating: 5 out of 5 stars/i);
    expect(ratings.length).toBeGreaterThan(0);
  });

  it('hides decorative icons from assistive technology', () => {
    const { container } = render(<LandingPage />);
    const decorativeIcons = container.querySelectorAll(
      'svg[aria-hidden="true"]',
    );
    expect(decorativeIcons.length).toBeGreaterThan(0);
  });

  it('clips animated content at the page boundary on narrow viewports (#796)', () => {
    const { container } = render(<LandingPage />);
    const page = container.firstElementChild as HTMLElement;

    expect(page).toHaveClass('w-full', 'overflow-x-hidden');
    expect(screen.getByText(CONTRACT_ID).closest('a')).toHaveClass('min-w-0');
  });
});

describe('LandingPage – keyboard shortcuts (#1185)', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('single-key-shortcuts-enabled');
  });

  it('navigates to /chat when "g" is pressed', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<
      typeof useRouter
    >);

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

  it('honors the single-key preference for navigation and theme shortcuts', () => {
    const push = vi.fn();
    const toggleDarkMode = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<
      typeof useRouter
    >);
    vi.mocked(useTheme).mockReturnValue({ isDarkMode: false, toggleDarkMode });

    render(<LandingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable single-key shortcuts' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'd' });

    expect(push).not.toHaveBeenCalled();
    expect(toggleDarkMode).not.toHaveBeenCalled();
  });
});

describe('LandingPage – contract address (#1511)', () => {
  afterEach(cleanup);

  it('renders the contract address from the environment configuration', () => {
    render(<LandingPage />);
    const contractAddressElement = screen.getByText(CONTRACT_ID);
    expect(contractAddressElement).toBeDefined();
  });

  it('links the contract address to Stellar Expert explorer', () => {
    render(<LandingPage />);
    const contractLink = screen.getByText(CONTRACT_ID).closest('a');
    expect(contractLink).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`,
    );
    expect(contractLink).toHaveAttribute('target', '_blank');
    expect(contractLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
