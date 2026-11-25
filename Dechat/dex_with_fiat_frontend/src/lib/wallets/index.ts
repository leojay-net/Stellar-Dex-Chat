import { WalletAdapter, WalletInfo } from './types';
import { FreighterAdapter } from './freighter';
import { XBullAdapter } from './xbull';

const adapters: WalletAdapter[] = [new FreighterAdapter(), new XBullAdapter()];

const STORAGE_KEY_SELECTED_WALLET = 'stellar_selected_wallet';

export function getAllAdapters(): WalletAdapter[] {
  return adapters;
}

export function getAdapterById(id: string): WalletAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}

export async function getAvailableWallets(): Promise<WalletInfo[]> {
  const wallets = await Promise.all(
    adapters.map(async (adapter) => ({
      id: adapter.id,
      name: adapter.name,
      icon: adapter.icon,
      isInstalled: await adapter.isInstalled(),
      isConnected: false, // Will be updated by context
    })),
  );
  return wallets;
}

export function getSelectedWalletId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_SELECTED_WALLET);
}

export function setSelectedWalletId(id: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_SELECTED_WALLET, id);
}

export function clearSelectedWalletId(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_SELECTED_WALLET);
}

export async function getDefaultAdapter(): Promise<WalletAdapter | null> {
  // First try the remembered wallet
  const selectedId = getSelectedWalletId();
  if (selectedId) {
    const adapter = getAdapterById(selectedId);
    if (adapter && (await adapter.isInstalled())) {
      return adapter;
    }
  }

  // Fall back to the first installed wallet
  for (const adapter of adapters) {
    if (await adapter.isInstalled()) {
      setSelectedWalletId(adapter.id);
      return adapter;
    }
  }

  return null;
}
