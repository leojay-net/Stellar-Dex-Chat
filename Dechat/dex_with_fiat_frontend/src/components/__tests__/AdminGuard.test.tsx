import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    vi.unstubAllGlobals();
  });

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

  it('renders children after the nonce/signature handshake succeeds for the admin', async () => {
    // The guard builds a real transaction, so the account must be a valid key.
    const validAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);
    vi.mocked(getAdmin).mockResolvedValue(validAddr);
    vi.mocked(signTransaction).mockResolvedValue({
      signedTxXdr: 'signed-xdr',
      signerAddress: validAddr,
    } as any);

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/auth/nonce' && !init?.method) {
        return Response.json({
          nonce: Buffer.alloc(32, 1).toString('base64'),
        });
      }
      if (url.includes('/accounts/')) {
        return Response.json({ account_id: validAddr, sequence: '1' });
      }
      if (url === '/api/admin/auth/nonce' && init?.method === 'POST') {
        return Response.json({ success: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(await screen.findByTestId('protected-content')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    );
    expect(JSON.parse(post![1]!.body as string)).toMatchObject({
      signature: 'signed-xdr',
      address: validAddr,
    });
  });

  it('shows the server error and no children when the signature is rejected', async () => {
    const validAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
    vi.mocked(useStellarWallet).mockReturnValue({
      connection: { address: validAddr },
    } as any);
    vi.mocked(getAdmin).mockResolvedValue(validAddr);
    vi.mocked(signTransaction).mockResolvedValue({
      signedTxXdr: 'signed-xdr',
    } as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/accounts/')) {
          return Response.json({ account_id: validAddr, sequence: '1' });
        }
        if (init?.method === 'POST') {
          return Response.json({ error: 'Invalid signature' }, { status: 401 });
        }
        return Response.json({ nonce: Buffer.alloc(32, 1).toString('base64') });
      }),
    );

    render(
      <AdminGuard>
        <div data-testid="protected-content">Secret content</div>
      </AdminGuard>,
    );

    expect(await screen.findByText('Invalid signature')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
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

  it('surfaces the underlying message when getAdmin throws', async () => {
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

    // The guard renders the thrown Error's message (the generic text is only
    // used for non-Error rejections).
    expect(await screen.findByText('RPC failure')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});
