'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';
import {
  isConnected as freighterIsConnected,
  getAddress,
  getNetwork,
  signTransaction,
  requestAccess,
  setAllowed,
} from '@stellar/freighter-api';
import { fetchXlmBalance } from '@/lib/stellarContract';

/** Canonical Stellar testnet passphrase — avoids importing the full SDK at module scope. */
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY_ADDRESS = 'stellar_address';
const STORAGE_KEY_INDEX = 'stellar_selected_account_index';
const STORAGE_KEY_TIMESTAMP = 'stellar_connection_timestamp';

export const EXPECTED_NETWORK = 'TESTNET';

declare global {
  interface Window {
    freighter?: {
      getAccounts?: () => Promise<{ accounts: string[]; error?: string }>;
      setAllowedBack?: (address: string) => Promise<void>;
    };
    /** Test-only bridge, registered only for E2E or non-production builds. */
    mockStellarConnect?: (address: string) => void;
  }
}

async function getFreighterAccounts(): Promise<{
  accounts: string[];
  error?: string;
}> {
  if (typeof window !== 'undefined' && window.freighter?.getAccounts) {
    return window.freighter.getAccounts();
  }
  return { accounts: [], error: 'Freighter getAccounts not available' };
}

async function setFreighterAllowedBack(address: string): Promise<void> {
  if (typeof window !== 'undefined' && window.freighter?.setAllowedBack) {
    return window.freighter.setAllowedBack(address);
  }
  await setAllowed();
}

export interface StellarWalletConnection {
  address: string;
  publicKey: string;
  isConnected: boolean;
  network: string;
  networkPassphrase: string;
}

export interface WalletAccount {
  address: string;
  label?: string;
}

interface StellarWalletContextType {
  connection: StellarWalletConnection;
  accounts: WalletAccount[];
  selectedAccountIndex: number;
  xlmBalance: string;
  selectAccount: (index: number) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string) => Promise<string>;
  isFreighterInstalled: boolean;
  isLoading: boolean;
  error: string | null;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  mockConnect?: (address: string) => void;
  isNetworkMismatch: boolean;
  refreshXlmBalance: () => Promise<void>;
}

const defaultConnection: StellarWalletConnection = {
  address: '',
  publicKey: '',
  isConnected: false,
  network: '',
  networkPassphrase: '',
};

export const StellarWalletContext = createContext<
  StellarWalletContextType | undefined
>(undefined);

export function StellarWalletProvider({ children }: { children: ReactNode }) {
  const mockWalletEnabled =
    process.env.NEXT_PUBLIC_E2E === 'true' ||
    process.env.NODE_ENV !== 'production';
  const [connection, setConnection] =
    useState<StellarWalletConnection>(defaultConnection);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0);
  const [isFreighterInstalled, setIsFreighterInstalled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [xlmBalance, setXlmBalance] = useState('');

  useEffect(() => {
    const check = async () => {
      try {
        const result = await freighterIsConnected();
        setIsFreighterInstalled(!result.error && result.isConnected);
      } catch {
        setIsFreighterInstalled(false);
      }
    };
    check();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_ADDRESS);
    const storedIndex = localStorage.getItem(STORAGE_KEY_INDEX);
    const storedTimestamp = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
    if (stored && isFreighterInstalled) {
      const connectionTime = storedTimestamp
        ? parseInt(storedTimestamp, 10)
        : 0;
      const now = Date.now();
      if (now - connectionTime > SESSION_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY_ADDRESS);
        localStorage.removeItem(STORAGE_KEY_INDEX);
        localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
        setSessionExpired(true);
        setConnection(defaultConnection);
        setAccounts([]);
        setSelectedAccountIndex(0);
        return;
      }
      getAddress()
        .then(async (addrResult) => {
          if (!addrResult.error && addrResult.address === stored) {
            const netResult = await getNetwork();
            const accountsResult = await getFreighterAccounts();
            if (!accountsResult.error && accountsResult.accounts.length > 0) {
              const walletAccounts: WalletAccount[] =
                accountsResult.accounts.map((addr: string, idx: number) => ({
                  address: addr,
                  label: `Account ${idx + 1}`,
                }));
              setAccounts(walletAccounts);
              const savedIndex = storedIndex ? parseInt(storedIndex, 10) : 0;
              const validIndex = Math.min(
                savedIndex,
                walletAccounts.length - 1,
              );
              setSelectedAccountIndex(validIndex >= 0 ? validIndex : 0);
            }
            setConnection({
              address: addrResult.address,
              publicKey: addrResult.address,
              isConnected: true,
              network: netResult.network || 'TESTNET',
              networkPassphrase: netResult.networkPassphrase || '',
            });
            import('@/lib/stellarContract').then(({ fetchXlmBalance }) =>
              fetchXlmBalance(addrResult.address),
            );
            fetchXlmBalance(addrResult.address)
              .then(setXlmBalance)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [isFreighterInstalled]);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSessionExpired(false);
    try {
      const accessResult = await requestAccess();
      if (accessResult.error) throw new Error(String(accessResult.error));

      const addrResult = await getAddress();
      if (addrResult.error) throw new Error(String(addrResult.error));

      const netResult = await getNetwork();
      const accountsResult = await getFreighterAccounts();

      const passphrase = netResult.networkPassphrase || '';
      if (passphrase !== TESTNET_PASSPHRASE) {
        setError('Please switch Freighter to Testnet');
        setConnection(defaultConnection);
        setAccounts([]);
        setSelectedAccountIndex(0);
        return;
      }

      const addr = addrResult.address;
      const now = Date.now();
      localStorage.setItem(STORAGE_KEY_ADDRESS, addr);
      localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(now));

      if (!accountsResult.error && accountsResult.accounts.length > 0) {
        const walletAccounts: WalletAccount[] = accountsResult.accounts.map(
          (a: string, idx: number) => ({
            address: a,
            label: `Account ${idx + 1}`,
          }),
        );
        setAccounts(walletAccounts);
        const currentIndex = accountsResult.accounts.indexOf(addr);
        setSelectedAccountIndex(currentIndex >= 0 ? currentIndex : 0);
        localStorage.setItem(
          STORAGE_KEY_INDEX,
          String(currentIndex >= 0 ? currentIndex : 0),
        );
      }

      setConnection({
        address: addr,
        publicKey: addr,
        isConnected: true,
        network: netResult.network || 'TESTNET',
        networkPassphrase: passphrase,
      });
      import('@/lib/stellarContract').then(({ fetchXlmBalance }) =>
        fetchXlmBalance(addr),
      );
      fetchXlmBalance(addr)
        .then(setXlmBalance)
        .catch(() => {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect Freighter',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!connection.isConnected) return;

    let cancelled = false;
    let syncing = false;
    let activeAddress = connection.address;

    const syncWallet = async () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        const [addressResult, networkResult, accountsResult] =
          await Promise.all([
            getAddress(),
            getNetwork(),
            getFreighterAccounts(),
          ]);
        if (cancelled) return;
        if (addressResult.error || !addressResult.address) {
          setConnection(defaultConnection);
          setAccounts([]);
          setSelectedAccountIndex(0);
          setXlmBalance('');
          localStorage.removeItem(STORAGE_KEY_ADDRESS);
          localStorage.removeItem(STORAGE_KEY_INDEX);
          localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
          return;
        }

        const address = addressResult.address;
        const walletAccounts = accountsResult.error
          ? []
          : accountsResult.accounts.map((account, index) => ({
              address: account,
              label: `Account ${index + 1}`,
            }));
        const accountIndex = Math.max(
          0,
          walletAccounts.findIndex((account) => account.address === address),
        );
        const network = networkResult.network || '';
        const networkPassphrase = networkResult.networkPassphrase || '';

        setConnection((previous) => {
          if (
            previous.address === address &&
            previous.network === network &&
            previous.networkPassphrase === networkPassphrase
          ) {
            return previous;
          }
          return {
            address,
            publicKey: address,
            isConnected: true,
            network,
            networkPassphrase,
          };
        });

        if (walletAccounts.length > 0) {
          setAccounts((previous) =>
            previous.length === walletAccounts.length &&
            previous.every(
              (account, index) =>
                account.address === walletAccounts[index].address,
            )
              ? previous
              : walletAccounts,
          );
          setSelectedAccountIndex(accountIndex);
          localStorage.setItem(STORAGE_KEY_INDEX, String(accountIndex));
        }

        if (address !== activeAddress) {
          activeAddress = address;
          localStorage.setItem(STORAGE_KEY_ADDRESS, address);
          localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(Date.now()));
          fetchXlmBalance(address)
            .then((balance: string) => {
              if (!cancelled && activeAddress === address) {
                setXlmBalance(balance);
              }
            })
            .catch(() => {});
        }
      } catch {
        // Keep the last known wallet state when Freighter is temporarily unavailable.
      } finally {
        syncing = false;
      }
    };

    void syncWallet();
    const interval = setInterval(() => void syncWallet(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection.isConnected]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY_ADDRESS);
    localStorage.removeItem(STORAGE_KEY_INDEX);
    localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
    setConnection(defaultConnection);
    setAccounts([]);
    setSelectedAccountIndex(0);
    setXlmBalance('');
    setError(null);
    setSessionExpired(false);
  }, []);

  const signTx = useCallback(
    async (xdr: string): Promise<string> => {
      if (!connection.isConnected) {
        throw new Error('Wallet is not connected');
      }

      const [addressResult, networkResult] = await Promise.all([
        getAddress(),
        getNetwork(),
      ]);
      if (addressResult.error || !addressResult.address) {
        throw new Error('Unable to verify the active Freighter account');
      }

      const network = networkResult.network || '';
      const networkPassphrase = networkResult.networkPassphrase || '';
      const address = addressResult.address;
      if (
        address !== connection.address ||
        networkPassphrase !== TESTNET_PASSPHRASE
      ) {
        setConnection((previous) => ({
          ...previous,
          address,
          publicKey: address,
          network,
          networkPassphrase,
        }));
        if (address !== connection.address) {
          fetchXlmBalance(address)
            .then(setXlmBalance)
            .catch(() => {});
        }
        throw new Error(
          networkPassphrase !== TESTNET_PASSPHRASE
            ? 'Please switch Freighter to Testnet'
            : 'Freighter account changed. Please retry the transaction.',
        );
      }

      const result = await signTransaction(xdr, {
        networkPassphrase,
        address,
      });
      if (result.error) throw new Error(String(result.error));
      return result.signedTxXdr;
    },
    [connection.address, connection.isConnected],
  );

  const selectAccount = useCallback(
    async (index: number) => {
      if (index < 0 || index >= accounts.length) return;
      const selectedAccount = accounts[index];
      try {
        await setFreighterAllowedBack(selectedAccount.address);
        setSelectedAccountIndex(index);
        localStorage.setItem(STORAGE_KEY_INDEX, String(index));
        setConnection((prev) => ({
          ...prev,
          address: selectedAccount.address,
          publicKey: selectedAccount.address,
        }));
        localStorage.setItem(STORAGE_KEY_ADDRESS, selectedAccount.address);
        localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(Date.now()));
        import('@/lib/stellarContract').then(({ fetchXlmBalance }) =>
          fetchXlmBalance(selectedAccount.address),
        );
        fetchXlmBalance(selectedAccount.address)
          .then(setXlmBalance)
          .catch(() => {});
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to switch account',
        );
      }
    },
    [accounts],
  );

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  const refreshXlmBalance = useCallback(async () => {
    if (!connection.address) return;
    try {
      const balance = await fetchXlmBalance(connection.address);
      setXlmBalance(balance);
    } catch (error) {
      console.error('Failed to refresh XLM balance:', error);
    }
  }, [connection.address]);

  const mockConnect = useCallback((addr: string) => {
    const connectionData = {
      address: addr,
      publicKey: addr,
      isConnected: true,
      network: 'TESTNET',
      networkPassphrase: TESTNET_PASSPHRASE,
    };
    setConnection(connectionData);
    localStorage.setItem(STORAGE_KEY_ADDRESS, addr);
    localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(Date.now()));
  }, []);

  useEffect(() => {
    if (!mockWalletEnabled || typeof window === 'undefined') return;
    window.mockStellarConnect = mockConnect;
    return () => {
      if (window.mockStellarConnect === mockConnect) {
        delete window.mockStellarConnect;
      }
    };
  }, [mockConnect, mockWalletEnabled]);

  const isNetworkMismatch =
    connection.isConnected &&
    connection.networkPassphrase !== TESTNET_PASSPHRASE;

  const contextValue = useMemo(
    () => ({
      connection,
      accounts,
      selectedAccountIndex,
      xlmBalance,
      selectAccount,
      connect,
      disconnect,
      signTx,
      isFreighterInstalled,
      isLoading,
      error,
      sessionExpired,
      clearSessionExpired,
      ...(mockWalletEnabled ? { mockConnect } : {}),
      isNetworkMismatch,
      refreshXlmBalance,
    }),
    [
      connection,
      accounts,
      selectedAccountIndex,
      xlmBalance,
      selectAccount,
      connect,
      disconnect,
      signTx,
      isFreighterInstalled,
      isLoading,
      error,
      sessionExpired,
      clearSessionExpired,
      mockConnect,
      mockWalletEnabled,
      isNetworkMismatch,
      refreshXlmBalance,
    ],
  );

  return (
    <StellarWalletContext.Provider value={contextValue}>
      {children}
    </StellarWalletContext.Provider>
  );
}

export function useStellarWallet() {
  const ctx = useContext(StellarWalletContext);
  if (!ctx)
    throw new Error(
      'useStellarWallet must be used inside StellarWalletProvider',
    );
  return ctx;
}
