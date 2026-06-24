import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdminGuard from '../AdminGuard';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';

vi.mock('@/contexts/StellarWalletContext');
vi.mock('@/lib/stellarContract');
// Avoid JSX in vi.mock factory (hoisted before JSX transform). Use createElement at runtime.
vi.mock('@/components/LandingPage', () => ({
  default: function MockLandingPage() {
    return React.createElement('div', { 'data-testid': 'landing-page' }, 'Landing Page');
  },
}));

const VALID_STELLAR_ADDRESS =
  'G1234567890123456789012345678901234567890123456789012345';
const OTHER_STELLAR_ADDRESS =
  'G9876543210987654321098765432109876543210987654321098765';

describe('AdminGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing page when connection address is empty', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: '' },
    } as unknown as any);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('shows error if connected address has invalid format (Zod validation)', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: 'invalid-address-not-starting-with-g-or-correct-length' },
    } as unknown as any);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByText('Invalid wallet address format. Access denied.')).toBeInTheDocument();
  });

  it('shows error if contract admin address has invalid format (Zod validation)', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: VALID_STELLAR_ADDRESS },
    } as unknown as any);
    vi.mocked(getAdmin).mockResolvedValue('invalid-admin-address');

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByText('Invalid contract configuration. Access denied.')).toBeInTheDocument();
  });

  it('renders children when connected address matches admin address exactly', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: VALID_STELLAR_ADDRESS },
    } as unknown as any);
    vi.mocked(getAdmin).mockResolvedValue(VALID_STELLAR_ADDRESS);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByTestId('protected-content')).toBeInTheDocument();
  });

  it('renders landing page when valid connected address does not match valid admin address', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: VALID_STELLAR_ADDRESS },
    } as unknown as any);
    vi.mocked(getAdmin).mockResolvedValue(OTHER_STELLAR_ADDRESS);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
  });
});

describe('AdminGuard — auto-scroll on access granted (#490)', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    scrollToSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollToSpy, writable: true });
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: VALID_STELLAR_ADDRESS },
    } as unknown as any);
  });

  it('scrolls to top with smooth behavior when admin access is granted', async () => {
    vi.mocked(getAdmin).mockResolvedValue(VALID_STELLAR_ADDRESS);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('does not scroll when access is denied', async () => {
    vi.mocked(getAdmin).mockResolvedValue(OTHER_STELLAR_ADDRESS);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('does not scroll when there is an error', async () => {
    vi.mocked(getAdmin).mockRejectedValue(new Error('network error'));

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    await waitFor(() => {
      expect(screen.getByText(/failed to verify/i)).toBeInTheDocument();
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

describe('AdminGuard — offline retry queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: VALID_STELLAR_ADDRESS },
    } as unknown as any);
  });

  afterEach(() => {
    // Restore navigator.onLine to its default (true) after each test.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('shows the offline banner and queues a retry when navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
    expect(await screen.findByText(/retry automatically/i)).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    // getAdmin should NOT be called while offline
    expect(vi.mocked(getAdmin)).not.toHaveBeenCalled();
  });

  it('retries the admin check and grants access when connection is restored', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.mocked(getAdmin).mockResolvedValue(VALID_STELLAR_ADDRESS);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    // Offline banner visible
    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();

    // Simulate coming back online
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    // Admin check runs and grants access
    expect(await screen.findByTestId('protected-content')).toBeInTheDocument();
    expect(vi.mocked(getAdmin)).toHaveBeenCalledTimes(1);
  });

  it('sets isOnline to false and does not retry when offline event fires', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    vi.mocked(getAdmin).mockResolvedValue(VALID_STELLAR_ADDRESS);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    // Initially online — content is shown
    expect(await screen.findByTestId('protected-content')).toBeInTheDocument();

    // Go offline
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    // Content still shown (guard doesn't revoke access on offline event alone)
    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });
});
