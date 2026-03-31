'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
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
import { Networks } from '@stellar/stellar-sdk';

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
  selectAccount: (index: number) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string) => Promise<string>;
  isFreighterInstalled: boolean;
  isLoading: boolean;
  error: string | null;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  mockConnect: (address: string) => void;
  isNetworkMismatch: boolean;
}

const defaultConnection: StellarWalletConnection = {
  address: '',
  publicKey: '',
  isConnected: false,
  network: '',
  networkPassphrase: '',
};

const StellarWalletContext = createContext<StellarWalletContextType>({
  connection: defaultConnection,
  accounts: [],
  selectedAccountIndex: 0,
  selectAccount: () => {},
  connect: async () => {},
  disconnect: () => {},
  signTx: async () => '',
  isFreighterInstalled: false,
  isLoading: false,
  error: null,
  sessionExpired: false,
  clearSessionExpired: () => {},
  mockConnect: () => {},
  isNetworkMismatch: false,
});

export function StellarWalletProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] =
    useState<StellarWalletConnection>(defaultConnection);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0);
  const [isFreighterInstalled, setIsFreighterInstalled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

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
      if (passphrase !== Networks.TESTNET) {
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
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect Freighter',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY_ADDRESS);
    localStorage.removeItem(STORAGE_KEY_INDEX);
    localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
    setConnection(defaultConnection);
    setAccounts([]);
    setSelectedAccountIndex(0);
    setError(null);
    setSessionExpired(false);
  }, []);

  const signTx = useCallback(
    async (xdr: string): Promise<string> => {
      const result = await signTransaction(xdr, {
        networkPassphrase: connection.networkPassphrase,
        address: connection.address,
      });
      if (result.error) throw new Error(String(result.error));
      return result.signedTxXdr;
    },
    [connection.address, connection.networkPassphrase],
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

  const mockConnect = useCallback((addr: string) => {
    const connectionData = {
      address: addr,
      publicKey: addr,
      isConnected: true,
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    };
    setConnection(connectionData);
    localStorage.setItem(STORAGE_KEY_ADDRESS, addr);
    localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(Date.now()));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.mockStellarConnect = mockConnect;
    }
  }, [mockConnect]);

  const isNetworkMismatch =
    connection.isConnected &&
    connection.network !== '' &&
    connection.network.toUpperCase() !== EXPECTED_NETWORK;

  return (
    <StellarWalletContext.Provider
      value={{
        connection,
        accounts,
        selectedAccountIndex,
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
        isNetworkMismatch,
      }}
    >
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
