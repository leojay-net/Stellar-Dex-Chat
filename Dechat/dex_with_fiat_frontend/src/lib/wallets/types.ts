/**
 * Wallet adapter interface for Stellar wallets
 */
export interface WalletAdapter {
  /** Unique identifier for the wallet */
  id: string;
  /** Display name of the wallet */
  name: string;
  /** Icon URL or emoji */
  icon?: string;
  
  /** Check if the wallet is installed/available */
  isInstalled(): Promise<boolean>;
  
  /** Connect to the wallet and get address */
  connect(): Promise<{ address: string; network: string; networkPassphrase: string }>;
  
  /** Get the connected address */
  getAddress(): Promise<string | null>;
  
  /** Get the network information */
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  
  /** Sign a transaction */
  signTransaction(xdr: string, options?: { address?: string; networkPassphrase?: string }): Promise<string>;
  
  /** Disconnect from the wallet */
  disconnect(): Promise<void>;
  
  /** Get all accounts in the wallet */
  getAccounts(): Promise<string[]>;
  
  /** Switch to a specific account */
  switchAccount(address: string): Promise<void>;
  
  /** Check if the wallet supports multiple accounts */
  supportsMultipleAccounts(): boolean;
}

export interface WalletInfo {
  id: string;
  name: string;
  icon?: string;
  isInstalled: boolean;
  isConnected: boolean;
}
