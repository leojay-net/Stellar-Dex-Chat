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
import { fetchXlmBalance } from '@/lib/stellarContract';
import { WalletAdapter, WalletInfo } from '@/lib/wallets/types';
import {
  getAdapterById,
  getAvailableWallets,
  getDefaultAdapter,
  setSelectedWalletId,
} from '@/lib/wallets';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY_ADDRESS = 'stellar_address';
const STORAGE_KEY_INDEX = 'stellar_selected_account_index';
const STORAGE_KEY_TIMESTAMP = 'stellar_connection_timestamp';

export const EXPECTED_NETWORK = 'TESTNET';

declare global {
  interface Window {
    xBull?: {
      isInstalled?: () => boolean;
      connect?: () => Promise<{
        address: string;
        network: string;
        networkPassphrase: string;
      }>;
      getAddress?: () => Promise<string>;
      getNetwork?: () => Promise<{
        network: string;
        networkPassphrase: string;
      }>;
      signTransaction?: (
        xdr: string,
        options?: { address?: string; networkPassphrase?: string },
      ) => Promise<string>;
      disconnect?: () => Promise<void>;
      getAccounts?: () => Promise<string[]>;
      switchAccount?: (address: string) => Promise<void>;
    };
    /** Test-only bridge, registered only for E2E or non-production builds. */
    mockStellarConnect?: (address: string) => void;
  }
}

export interface StellarWalletConnection {
  address: string;
  publicKey: string;
  isConnected: boolean;
  network: string;
  networkPassphrase: string;
  walletId?: string;
  walletName?: string;
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
  // New wallet adapter methods
  availableWallets: WalletInfo[];
  selectedWalletId: string | null;
  selectWallet: (walletId: string) => Promise<void>;
  activeAdapter: WalletAdapter | null;
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
  const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([]);
  const [selectedWalletId, setSelectedWalletIdState] = useState<string | null>(
    null,
  );
  const [activeAdapter, setActiveAdapter] = useState<WalletAdapter | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const initWallets = async () => {
      try {
        const wallets = await getAvailableWallets();
        if (cancelled) return;
        setAvailableWallets(wallets);

        const freighter = wallets.find((wallet) => wallet.id === 'freighter');
        setIsFreighterInstalled(freighter?.isInstalled ?? false);

        const adapter = await getDefaultAdapter();
        if (!cancelled && adapter) {
          setActiveAdapter(adapter);
          setSelectedWalletIdState(adapter.id);
        }
      } catch (initError) {
        if (!cancelled) {
          setError(
            initError instanceof Error
              ? initError.message
              : 'Failed to initialize wallets',
          );
        }
      }
    };
    void initWallets();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeAdapter) return;
    let cancelled = false;

    const restoreSession = async () => {
      const stored = localStorage.getItem(STORAGE_KEY_ADDRESS);
      const storedIndex = localStorage.getItem(STORAGE_KEY_INDEX);
      const storedTimestamp = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
      if (!stored || !(await activeAdapter.isInstalled())) return;

      const connectionTime = storedTimestamp
        ? parseInt(storedTimestamp, 10)
        : 0;
      if (Date.now() - connectionTime > SESSION_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY_ADDRESS);
        localStorage.removeItem(STORAGE_KEY_INDEX);
        localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
        setSessionExpired(true);
        setConnection(defaultConnection);
        setAccounts([]);
        setSelectedAccountIndex(0);
        return;
      }

      const address = await activeAdapter.getAddress();
      if (cancelled || address !== stored) return;

      const [netResult, accountsResult] = await Promise.all([
        activeAdapter.getNetwork(),
        activeAdapter.getAccounts(),
      ]);
      if (cancelled) return;

      const walletAccounts = accountsResult.map((account, index) => ({
        address: account,
        label: `Account ${index + 1}`,
      }));
      setAccounts(walletAccounts);
      const savedIndex = storedIndex ? parseInt(storedIndex, 10) : 0;
      const validIndex = Math.min(savedIndex, walletAccounts.length - 1);
      setSelectedAccountIndex(validIndex >= 0 ? validIndex : 0);
      setConnection({
        address,
        publicKey: address,
        isConnected: true,
        network: netResult.network || 'TESTNET',
        networkPassphrase: netResult.networkPassphrase || '',
        walletId: activeAdapter.id,
        walletName: activeAdapter.name,
      });

      const balance = await fetchXlmBalance(address);
      if (!cancelled) setXlmBalance(balance);
    };

    void restoreSession().catch((restoreError: unknown) => {
      if (!cancelled) {
        setError(
          restoreError instanceof Error
            ? restoreError.message
            : 'Failed to restore wallet session',
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeAdapter]);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSessionExpired(false);
    try {
      const adapter = activeAdapter ?? (await getDefaultAdapter());
      if (!adapter) {
        setError('No wallet adapter available');
        return;
      }
      if (!activeAdapter) {
        setActiveAdapter(adapter);
        setSelectedWalletIdState(adapter.id);
      }

      const result = await adapter.connect();

      const passphrase = result.networkPassphrase;
      if (passphrase !== TESTNET_PASSPHRASE) {
        setError(`Please switch ${adapter.name} to Testnet`);
        setConnection(defaultConnection);
        setAccounts([]);
        setSelectedAccountIndex(0);
        return;
      }

      const addr = result.address;
      const now = Date.now();
      localStorage.setItem(STORAGE_KEY_ADDRESS, addr);
      localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(now));

      const accountsResult = await adapter.getAccounts();
      if (accountsResult.length > 0) {
        const walletAccounts: WalletAccount[] = accountsResult.map(
          (a: string, idx: number) => ({
            address: a,
            label: `Account ${idx + 1}`,
          }),
        );
        setAccounts(walletAccounts);
        const currentIndex = accountsResult.indexOf(addr);
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
        network: result.network || 'TESTNET',
        networkPassphrase: passphrase,
        walletId: adapter.id,
        walletName: adapter.name,
      });
      fetchXlmBalance(addr)
        .then(setXlmBalance)
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    } finally {
      setIsLoading(false);
    }
  }, [activeAdapter]);

  // Sync wallet state periodically
  useEffect(() => {
    if (!connection.isConnected || !activeAdapter) return;

    let cancelled = false;
    let syncing = false;
    let activeAddress = connection.address;

    const syncWallet = async () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        const [address, netResult, accountsResult] = await Promise.all([
          activeAdapter.getAddress(),
          activeAdapter.getNetwork(),
          activeAdapter.getAccounts(),
        ]);
        if (cancelled) return;
        if (!address) {
          setConnection(defaultConnection);
          setAccounts([]);
          setSelectedAccountIndex(0);
          setXlmBalance('');
          localStorage.removeItem(STORAGE_KEY_ADDRESS);
          localStorage.removeItem(STORAGE_KEY_INDEX);
          localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
          return;
        }

        const walletAccounts = accountsResult.map((account, index) => ({
          address: account,
          label: `Account ${index + 1}`,
        }));
        const accountIndex = Math.max(
          0,
          walletAccounts.findIndex((account) => account.address === address),
        );

        setConnection((previous) => {
          if (
            previous.address === address &&
            previous.network === netResult.network &&
            previous.networkPassphrase === netResult.networkPassphrase
          ) {
            return previous;
          }
          return {
            address,
            publicKey: address,
            isConnected: true,
            network: netResult.network,
            networkPassphrase: netResult.networkPassphrase,
            walletId: activeAdapter.id,
            walletName: activeAdapter.name,
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
        // Keep the last known wallet state when wallet is temporarily unavailable.
      } finally {
        syncing = false;
      }
    };

    const interval = setInterval(() => void syncWallet(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection.address, connection.isConnected, activeAdapter]);

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
      if (!connection.isConnected || !activeAdapter) {
        throw new Error('Wallet is not connected');
      }

      const [address, netResult] = await Promise.all([
        activeAdapter.getAddress(),
        activeAdapter.getNetwork(),
      ]);
      if (!address) {
        throw new Error(
          `Unable to verify the active ${activeAdapter.name} account`,
        );
      }

      const network = netResult.network;
      const networkPassphrase = netResult.networkPassphrase;
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
            ? `Please switch ${activeAdapter.name} to Testnet`
            : `${activeAdapter.name} account changed. Please retry the transaction.`,
        );
      }

      return activeAdapter.signTransaction(xdr, {
        address,
        networkPassphrase,
      });
    },
    [connection.address, connection.isConnected, activeAdapter],
  );

  const selectAccount = useCallback(
    async (index: number) => {
      if (!activeAdapter || index < 0 || index >= accounts.length) return;
      const selectedAccount = accounts[index];
      try {
        await activeAdapter.switchAccount(selectedAccount.address);
        setSelectedAccountIndex(index);
        localStorage.setItem(STORAGE_KEY_INDEX, String(index));
        setConnection((prev) => ({
          ...prev,
          address: selectedAccount.address,
          publicKey: selectedAccount.address,
        }));
        localStorage.setItem(STORAGE_KEY_ADDRESS, selectedAccount.address);
        localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(Date.now()));
        fetchXlmBalance(selectedAccount.address)
          .then(setXlmBalance)
          .catch(() => {});
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to switch account',
        );
      }
    },
    [accounts, activeAdapter],
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

  const selectWallet = useCallback(async (walletId: string) => {
    const adapter = getAdapterById(walletId);
    if (!adapter) {
      const message = 'Wallet not found';
      setError(message);
      throw new Error(message);
    }

    if (!(await adapter.isInstalled())) {
      const message = `${adapter.name} is not installed`;
      setError(message);
      throw new Error(message);
    }

    setActiveAdapter(adapter);
    setSelectedWalletId(walletId);
    setSelectedWalletIdState(walletId);
    setConnection(defaultConnection);
    setAccounts([]);
    setSelectedAccountIndex(0);
    setXlmBalance('');
    setError(null);
  }, []);

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
      availableWallets,
      selectedWalletId,
      selectWallet,
      activeAdapter,
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
      availableWallets,
      selectedWalletId,
      selectWallet,
      activeAdapter,
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
