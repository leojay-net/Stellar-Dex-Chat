import { WalletAdapter } from './types';
import {
  isConnected as freighterIsConnected,
  getAddress,
  getNetwork,
  signTransaction,
  requestAccess,
  setAllowed,
} from '@stellar/freighter-api';

declare global {
  interface Window {
    freighter?: {
      getAccounts?: () => Promise<{ accounts: string[]; error?: string }>;
      setAllowedBack?: (address: string) => Promise<void>;
    };
  }
}

export class FreighterAdapter implements WalletAdapter {
  id = 'freighter';
  name = 'Freighter';
  icon = '🔮';

  async isInstalled(): Promise<boolean> {
    try {
      const result = await freighterIsConnected();
      return !result.error && result.isConnected;
    } catch {
      return false;
    }
  }

  async connect(): Promise<{
    address: string;
    network: string;
    networkPassphrase: string;
  }> {
    const accessResult = await requestAccess();
    if (accessResult.error) {
      throw new Error(String(accessResult.error));
    }

    const addrResult = await getAddress();
    if (addrResult.error || !addrResult.address) {
      throw new Error(
        addrResult.error ? String(addrResult.error) : 'No address returned',
      );
    }

    const netResult = await getNetwork();
    return {
      address: addrResult.address,
      network: netResult.network || 'TESTNET',
      networkPassphrase: netResult.networkPassphrase || '',
    };
  }

  async getAddress(): Promise<string | null> {
    try {
      const result = await getAddress();
      if (result.error || !result.address) return null;
      return result.address;
    } catch {
      return null;
    }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    try {
      const result = await getNetwork();
      return {
        network: result.network || '',
        networkPassphrase: result.networkPassphrase || '',
      };
    } catch {
      return { network: '', networkPassphrase: '' };
    }
  }

  async signTransaction(
    xdr: string,
    options?: { address?: string; networkPassphrase?: string },
  ): Promise<string> {
    const [addressResult, networkResult] = await Promise.all([
      getAddress(),
      getNetwork(),
    ]);

    if (addressResult.error || !addressResult.address) {
      throw new Error('Unable to verify the active Freighter account');
    }

    const result = await signTransaction(xdr, {
      networkPassphrase:
        networkResult.networkPassphrase || options?.networkPassphrase || '',
      address: options?.address || addressResult.address,
    });

    if (result.error) {
      throw new Error(String(result.error));
    }

    return result.signedTxXdr;
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't have a direct disconnect API
    // The connection is managed through the session
  }

  async getAccounts(): Promise<string[]> {
    if (typeof window !== 'undefined' && window.freighter?.getAccounts) {
      try {
        const result = await window.freighter.getAccounts();
        if (!result.error && result.accounts) {
          return result.accounts;
        }
      } catch {
        // Fall through to empty array
      }
    }
    return [];
  }

  async switchAccount(address: string): Promise<void> {
    if (typeof window !== 'undefined' && window.freighter?.setAllowedBack) {
      try {
        await window.freighter.setAllowedBack(address);
        return;
      } catch {
        // Fall through to setAllowed
      }
    }
    await setAllowed();
  }

  supportsMultipleAccounts(): boolean {
    return true;
  }
}
