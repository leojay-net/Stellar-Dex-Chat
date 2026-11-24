import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

describe('Environment Variables', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT;
    delete process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT;
    delete process.env.NEXT_PUBLIC_STELLAR_RPC_URL;
    delete process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.PAYOUT_PROVIDER;
  });

  it('clientEnv provides defaults when variables are missing', async () => {
    const { clientEnv } = await import('./clientEnv');
    expect(clientEnv.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT).toBe(
      'CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR',
    );
    expect(clientEnv.NEXT_PUBLIC_XLM_SAC_CONTRACT).toBe(
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    );
    expect(clientEnv.NEXT_PUBLIC_STELLAR_RPC_URL).toBe(
      'https://soroban-testnet.stellar.org',
    );
  });

  it('clientEnv validates URLs', async () => {
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL = 'invalid-url';
    await expect(import('./clientEnv')).rejects.toThrow(
      'Invalid client environment variables',
    );
  });

  it('clientEnv validates Horizon URL', async () => {
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL = 'invalid-url';
    await expect(import('./clientEnv')).rejects.toThrow(
      'Invalid client environment variables',
    );
  });

  it('clientEnv validates Sentry DSN', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'invalid-url';
    await expect(import('./clientEnv')).rejects.toThrow(
      'Invalid client environment variables',
    );
  });

  it('serverEnv provides defaults when variables are missing', async () => {
    const { serverEnv } = await import('./serverEnv');
    expect(serverEnv.PAYOUT_PROVIDER).toBe('paystack');
  });
});
