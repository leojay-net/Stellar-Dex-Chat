import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminGuard from '../AdminGuard';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';

vi.mock('@/contexts/StellarWalletContext');
vi.mock('@/lib/stellarContract');
vi.mock('@/components/LandingPage', () => ({
  default: () => <div data-testid="landing-page">Landing Page</div>,
}));

describe('AdminGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing page when connection address is empty', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: '' },
    } as any);

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
    } as any);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByText('Invalid wallet address format. Access denied.')).toBeInTheDocument();
  });

  it('shows error if contract admin address has invalid format (Zod validation)', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE' }, // 56 chars
    } as any);
    vi.mocked(getAdmin).mockResolvedValue('invalid-admin-address');

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByText('Invalid contract configuration. Access denied.')).toBeInTheDocument();
  });

  it('renders children when connected address matches admin address exactly', async () => {
    const validAddr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE';
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);
    vi.mocked(getAdmin).mockResolvedValue(validAddr);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByTestId('protected-content')).toBeInTheDocument();
  });

  it('renders landing page when valid connected address does not match valid admin address', async () => {
    const userAddr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE';
    const adminAddr = 'G1234567890123456789012345678901234567890123456789012345';
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: userAddr },
    } as any);
    vi.mocked(getAdmin).mockResolvedValue(adminAddr);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>
    );

    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
  });
});
