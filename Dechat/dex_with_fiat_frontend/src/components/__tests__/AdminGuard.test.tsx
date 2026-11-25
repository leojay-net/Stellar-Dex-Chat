import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import AdminGuard, { stellarAddressSchema } from '../AdminGuard';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { getAdmin } from '@/lib/stellarContract';
import { signTransaction } from '@stellar/freighter-api';
import { StrKey } from '@stellar/stellar-sdk';

vi.mock('@/contexts/StellarWalletContext');
vi.mock('@/lib/stellarContract');
vi.mock('@stellar/freighter-api', () => ({ signTransaction: vi.fn() }));
vi.mock('@/components/LandingPage', () => ({
  default: () => <div data-testid="landing-page">Landing Page</div>,
}));

// ── stellarAddressSchema unit tests ──────────────────────────────────────
describe('stellarAddressSchema', () => {
  it('accepts a valid 56-char G-prefixed address', () => {
    const addr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';
    expect(stellarAddressSchema.safeParse(addr).success).toBe(true);
  });

  it('rejects an address that does not start with G', () => {
    const addr = 'XABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';
    expect(stellarAddressSchema.safeParse(addr).success).toBe(false);
  });

  it('rejects an address shorter than 56 characters', () => {
    expect(stellarAddressSchema.safeParse('GABC').success).toBe(false);
  });

  it('rejects an address longer than 56 characters', () => {
    const addr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2X';
    expect(stellarAddressSchema.safeParse(addr).success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(stellarAddressSchema.safeParse('').success).toBe(false);
  });
});

// ── AdminGuard component tests ───────────────────────────────────────────
describe('AdminGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders landing page when connection address is empty', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: '' },
    } as any);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('shows error if connected address has invalid format (Zod validation)', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: {
        address: 'invalid-address-not-starting-with-g-or-correct-length',
      },
    } as any);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(
      await screen.findByText('Invalid wallet address format. Access denied.'),
    ).toBeInTheDocument();
  });

  it('shows error if contract admin address has invalid format (Zod validation)', async () => {
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: {
        address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2',
      }, // 56 chars
    } as any);
    vi.mocked(getAdmin).mockResolvedValue('invalid-admin-address');

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(
      await screen.findByText('Invalid contract configuration. Access denied.'),
    ).toBeInTheDocument();
  });

  it('renders children after the matching wallet establishes an admin session', async () => {
    const validAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
    const nonce = Buffer.alloc(32, 2).toString('base64');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ nonce }))
      .mockResolvedValueOnce(
        Response.json({ account_id: validAddr, sequence: '1' }),
      )
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(signTransaction).mockResolvedValue({
      signedTxXdr: 'signed-fixture',
      signerAddress: validAddr,
    });
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);
    vi.mocked(getAdmin).mockResolvedValue(validAddr);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(await screen.findByTestId('protected-content')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/auth/nonce');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://horizon-testnet.stellar.org/accounts/${validAddr}`,
    );
    expect(signTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ address: validAddr }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/auth/nonce',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          nonce,
          signature: 'signed-fixture',
          address: validAddr,
        }),
      }),
    );
  });

  it('renders landing page when valid connected address does not match valid admin address', async () => {
    const userAddr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';
    const adminAddr =
      'GBCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW2';
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: userAddr },
    } as any);
    vi.mocked(getAdmin).mockResolvedValue(adminAddr);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
  });

  it('shows error message when getAdmin throws', async () => {
    const validAddr =
      'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);
    vi.mocked(getAdmin).mockRejectedValue(new Error('RPC failure'));

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(await screen.findByText('RPC failure')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('does not update state after unmount (cancelled flag prevents stale setState)', async () => {
    const validAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));

    // getAdmin resolves only after a manual trigger so we can unmount first
    let resolveAdmin!: (v: string) => void;
    const adminPromise = new Promise<string>((res) => { resolveAdmin = res; });
    vi.mocked(getAdmin).mockReturnValue(adminPromise);

    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);

    const { unmount } = render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    // Unmount before the async check completes
    unmount();

    // Now resolve getAdmin — this must not cause a React setState-after-unmount warning
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => { errors.push(args); };

    resolveAdmin(validAddr);
    // Flush microtasks
    await new Promise((r) => setTimeout(r, 50));

    console.error = originalError;
    const stateWarning = errors.some(
      (e) => typeof e === 'string' && e.includes('unmounted component'),
    );
    expect(stateWarning).toBe(false);
  });

  it('cancels a pending check when the connected address changes', async () => {
    const validAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
    const secondAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));

    // First check never resolves during the test
    vi.mocked(getAdmin).mockReturnValue(new Promise(() => {}));

    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);

    const { rerender } = render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    // Change address — this triggers a re-render, which should cancel the
    // first effect and start a fresh check for the new address.
    vi.mocked(getAdmin).mockResolvedValue(secondAddr);
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: secondAddr },
    } as any);

    rerender(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    // With second address not matching any mock admin, guard shows landing page
    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});
