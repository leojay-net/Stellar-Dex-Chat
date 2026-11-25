import { WalletAdapter } from './types';

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
  }
}

export class XBullAdapter implements WalletAdapter {
  id = 'xbull';
  name = 'xBull';
  icon = '🐂';

  async isInstalled(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return !!window.xBull?.isInstalled?.();
  }

  async connect(): Promise<{
    address: string;
    network: string;
    networkPassphrase: string;
  }> {
    if (!window.xBull?.connect) {
      throw new Error('xBull wallet not available');
    }
    return window.xBull.connect();
  }

  async getAddress(): Promise<string | null> {
    if (!window.xBull?.getAddress) return null;
    try {
      return await window.xBull.getAddress();
    } catch {
      return null;
    }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    if (!window.xBull?.getNetwork) {
      return { network: '', networkPassphrase: '' };
    }
    try {
      return await window.xBull.getNetwork();
    } catch {
      return { network: '', networkPassphrase: '' };
    }
  }

  async signTransaction(
    xdr: string,
    options?: { address?: string; networkPassphrase?: string },
  ): Promise<string> {
    if (!window.xBull?.signTransaction) {
      throw new Error('xBull signTransaction not available');
    }
    return window.xBull.signTransaction(xdr, options);
  }

  async disconnect(): Promise<void> {
    if (window.xBull?.disconnect) {
      await window.xBull.disconnect();
    }
  }

  async getAccounts(): Promise<string[]> {
    if (!window.xBull?.getAccounts) return [];
    try {
      return await window.xBull.getAccounts();
    } catch {
      return [];
    }
  }

  async switchAccount(address: string): Promise<void> {
    if (window.xBull?.switchAccount) {
      await window.xBull.switchAccount(address);
    }
  }

  supportsMultipleAccounts(): boolean {
    return true;
  }
}
