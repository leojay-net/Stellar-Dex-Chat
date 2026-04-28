import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StellarChatInterface from '@/components/StellarChatInterface';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ fiatCurrency: 'NGN' }),
}));

vi.mock('@/contexts/StellarWalletContext', () => ({
  EXPECTED_NETWORK: 'Test',
  useStellarWallet: () => ({
    connection: {
      address: '',
      publicKey: '',
      isConnected: false,
      network: 'TEST',
    },
    accounts: [] as { address: string; name?: string }[],
    selectedAccountIndex: 0,
    selectAccount: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTx: vi.fn(),
    isFreighterInstalled: true,
    isLoading: false,
    error: null,
    sessionExpired: false,
    clearSessionExpired: vi.fn(),
    mockConnect: vi.fn(),
    isNetworkMismatch: false,
  }),
}));

vi.mock('@/hooks/useChat', () => ({
  default: () => ({
    messages: [] as { id: string; role: string; content: string; timestamp: Date }[],
    isLoading: false,
    sendMessage: vi.fn(),
    cancelPendingRequest: vi.fn(),
    clearChat: vi.fn(),
    loadChatSession: vi.fn(),
    currentSessionId: null as string | null,
    setTransactionReadyCallback: vi.fn(),
    setIsAdmin: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBridgeStats', () => ({
  default: () => ({
    balance: null,
    limit: null,
    totalDeposited: null,
    loading: false,
    error: null,
    refetchStats: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({
    entries: [],
    clearEntries: vi.fn(),
    updateEntry: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: () => ({
    sessions: [],
  }),
}));

vi.mock('@/hooks/useSplitView', () => ({
  useSplitView: () => ({
    state: {
      isOpen: false,
      leftSessionId: null,
      rightSessionId: null,
      selectedMessageId: null,
    },
    open: vi.fn(),
    close: vi.fn(),
    setLeftSession: vi.fn(),
    setRightSession: vi.fn(),
    swapSessions: vi.fn(),
    selectMessage: vi.fn(),
    leftSession: null,
    rightSession: null,
  }),
}));

vi.mock('@/hooks/usePaystackWebhookStatus', () => ({
  usePaystackWebhookStatus: () => undefined,
}));

vi.mock('@/lib/networkQueue', () => ({
  getQueuedReadRequestsCount: () => 0,
  subscribeToQueue: () => () => undefined,
  processQueue: vi.fn(),
}));

vi.mock('@/lib/stellarContract', () => ({
  getAdmin: vi.fn().mockResolvedValue(null),
  getWithdrawalQueueDepth: vi.fn().mockResolvedValue(0),
  stroopsToDisplay: (n: string | number) => String(n),
}));

vi.mock('@/components/ChatHistorySidebar', () => ({ default: () => null }));
vi.mock('@/components/ChatInput', () => ({ default: () => null }));
vi.mock('@/components/ChatMessages', () => ({ default: () => null }));
vi.mock('@/components/StellarFiatModal', () => ({ default: () => null }));
vi.mock('@/components/BankDetailsModal', () => ({ default: () => null }));
vi.mock('@/components/UserSettings', () => ({ default: () => null }));
vi.mock('@/components/WalletConnectionTimeline', () => ({ default: () => null }));
vi.mock('@/components/ReceiptDrawerWrapper', () => ({ default: () => null }));
vi.mock('@/components/SplitViewComparison', () => ({ default: () => null }));
vi.mock('@/components/ChatSearchPanel', () => ({ default: () => null }));
vi.mock('@/components/ui/skeleton/SkeletonChat', () => ({ default: () => null }));
vi.mock('@/components/ui/skeleton/SkeletonSidebar', () => ({ default: () => null }));
vi.mock('@/components/NotificationsCenter', () => ({
  default: function NotificationsBoom() {
    throw new Error('notifications test throw');
  },
}));

describe('StellarChatInterface', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the top-level interface error UI when a header child throws', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(<StellarChatInterface />);

    expect(screen.getByText('common.error_boundary_title')).toBeTruthy();
    expect(screen.getByText('common.error_boundary_message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
