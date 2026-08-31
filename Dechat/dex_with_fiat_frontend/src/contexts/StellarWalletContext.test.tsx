import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { StellarWalletProvider, useStellarWallet } from './StellarWalletContext';

const freighter = vi.hoisted(() => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
  setAllowed: vi.fn(),
}));

vi.mock('@stellar/freighter-api', () => freighter);

const fetchXlmBalance = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stellarContract', () => ({ fetchXlmBalance }));

function wrapper({ children }: { children: React.ReactNode }) {
  return <StellarWalletProvider>{children}</StellarWalletProvider>;
}

const ADDRESS = 'GABCDEF1234567890TESTADDRESS';
const SECOND_ADDRESS = 'GSECONDACCOUNTADDRESS1234567';

describe('StellarWalletContext', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { freighter?: unknown }).freighter;
    vi.clearAllMocks();
    freighter.isConnected.mockResolvedValue({ isConnected: false });
    freighter.getAddress.mockResolvedValue({ address: ADDRESS });
    freighter.getNetwork.mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: Networks.TESTNET,
    });
    freighter.requestAccess.mockResolvedValue({ address: ADDRESS });
    freighter.signTransaction.mockResolvedValue({ signedTxXdr: 'SIGNED_XDR' });
    freighter.setAllowed.mockResolvedValue({ isAllowed: true });
    fetchXlmBalance.mockResolvedValue('100.0000000');
  });

  it('defaults to a disconnected state when Freighter is not installed', async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    await waitFor(() => expect(result.current.isFreighterInstalled).toBe(false));

    expect(result.current.connection.isConnected).toBe(false);
    expect(result.current.accounts).toEqual([]);
    expect(result.current.xlmBalance).toBe('');
    expect(result.current.isNetworkMismatch).toBe(false);
  });

  describe('connect', () => {
    it('sets connection, balance, and persists to localStorage on success', async () => {
      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connection.isConnected).toBe(true);
      expect(result.current.connection.address).toBe(ADDRESS);
      expect(result.current.xlmBalance).toBe('100.0000000');
      expect(localStorage.getItem('stellar_address')).toBe(ADDRESS);
      expect(result.current.error).toBeNull();
    });

    it('sets an error and leaves the connection unset on a network mismatch', async () => {
      freighter.getNetwork.mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: Networks.PUBLIC,
      });

      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.error).toBe('Please switch Freighter to Testnet');
      expect(result.current.connection.isConnected).toBe(false);
    });

    it('sets an error when Freighter reports a failure', async () => {
      freighter.requestAccess.mockResolvedValue({
        error: 'User declined access',
      });

      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.error).toBe('User declined access');
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('disconnect resets connection, accounts, balance, and storage', async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.connection.isConnected).toBe(true);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.connection.isConnected).toBe(false);
    expect(result.current.accounts).toEqual([]);
    expect(result.current.xlmBalance).toBe('');
    expect(localStorage.getItem('stellar_address')).toBeNull();
  });

  describe('selectAccount', () => {
    it('switches the active account and persists the new selection', async () => {
      window.freighter = {
        getAccounts: vi
          .fn()
          .mockResolvedValue({ accounts: [ADDRESS, SECOND_ADDRESS] }),
      };

      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });
      expect(result.current.accounts).toHaveLength(2);

      await act(async () => {
        await result.current.selectAccount(1);
      });

      expect(result.current.selectedAccountIndex).toBe(1);
      expect(result.current.connection.address).toBe(SECOND_ADDRESS);
      expect(localStorage.getItem('stellar_selected_account_index')).toBe('1');
    });

    it('is a no-op for an out-of-range index', async () => {
      window.freighter = {
        getAccounts: vi.fn().mockResolvedValue({ accounts: [ADDRESS] }),
      };

      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });
      expect(result.current.accounts).toHaveLength(1);

      await act(async () => {
        await result.current.selectAccount(5);
      });

      expect(result.current.selectedAccountIndex).toBe(0);
    });
  });

  describe('signTx', () => {
    it('returns the signed XDR on success', async () => {
      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });

      const signed = await result.current.signTx('UNSIGNED_XDR');

      expect(signed).toBe('SIGNED_XDR');
    });

    it('throws when Freighter returns an error', async () => {
      freighter.signTransaction.mockResolvedValue({ error: 'User rejected' });
      const { result } = renderHook(() => useStellarWallet(), { wrapper });

      await act(async () => {
        await result.current.connect();
      });

      await expect(result.current.signTx('UNSIGNED_XDR')).rejects.toThrow(
        'User rejected',
      );
    });
  });

  it('mockConnect sets a TESTNET connection directly', () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => {
      result.current.mockConnect(ADDRESS);
    });

    expect(result.current.connection.isConnected).toBe(true);
    expect(result.current.connection.address).toBe(ADDRESS);
    expect(result.current.connection.network).toBe('TESTNET');
  });

  it('clearSessionExpired resets the sessionExpired flag after an expired session is detected', async () => {
    localStorage.setItem('stellar_address', ADDRESS);
    localStorage.setItem(
      'stellar_connection_timestamp',
      String(Date.now() - 25 * 60 * 60 * 1000),
    );
    freighter.isConnected.mockResolvedValue({ isConnected: true });

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    await waitFor(() => expect(result.current.sessionExpired).toBe(true));

    act(() => {
      result.current.clearSessionExpired();
    });

    expect(result.current.sessionExpired).toBe(false);
  });

  it('throws a clear error when consumed outside the provider', () => {
    expect(() => renderHook(() => useStellarWallet())).toThrow(
      'useStellarWallet must be used inside StellarWalletProvider',
    );
  });
});
