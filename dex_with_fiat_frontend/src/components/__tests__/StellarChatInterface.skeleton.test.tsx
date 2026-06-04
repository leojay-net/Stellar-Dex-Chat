import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StellarChatInterface from '@/components/StellarChatInterface';

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
};

const mockChatState: {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: ReturnType<typeof vi.fn>;
  cancelPendingRequest: ReturnType<typeof vi.fn>;
  clearChat: ReturnType<typeof vi.fn>;
  loadChatSession: ReturnType<typeof vi.fn>;
  currentSessionId: string | null;
  setTransactionReadyCallback: ReturnType<typeof vi.fn>;
  setIsAdmin: ReturnType<typeof vi.fn>;
} = {
  messages: [],
  isLoading: false,
  sendMessage: vi.fn(),
  cancelPendingRequest: vi.fn(),
  clearChat: vi.fn(),
  loadChatSession: vi.fn(),
  currentSessionId: null,
  setTransactionReadyCallback: vi.fn(),
  setIsAdmin: vi.fn(),
};

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  default: () => mockChatState,
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
  useChatHistory: () => ({ sessions: [] }),
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
vi.mock('@/components/ChatMessages', () => ({
  default: () => <div data-testid="chat-messages" />,
}));
vi.mock('@/components/StellarFiatModal', () => ({ default: () => null }));
vi.mock('@/components/BankDetailsModal', () => ({ default: () => null }));
vi.mock('@/components/UserSettings', () => ({ default: () => null }));
vi.mock('@/components/WalletConnectionTimeline', () => ({
  default: () => null,
}));
vi.mock('@/components/ReceiptDrawerWrapper', () => ({ default: () => null }));
vi.mock('@/components/SplitViewComparison', () => ({ default: () => null }));
vi.mock('@/components/ChatSearchPanel', () => ({ default: () => null }));
vi.mock('@/components/ui/skeleton/SkeletonChat', () => ({
  default: () => <div data-testid="skeleton-chat" />,
}));
vi.mock('@/components/ui/skeleton/SkeletonSidebar', () => ({
  default: () => null,
}));
vi.mock('@/components/NotificationsCenter', () => ({ default: () => null }));

describe('StellarChatInterface - skeleton loading state', () => {
  beforeEach(() => {
    mockChatState.messages = [];
    mockChatState.isLoading = false;
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
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

  it('renders the chat skeleton while loading with no messages yet', () => {
    mockChatState.isLoading = true;
    mockChatState.messages = [];

    render(<StellarChatInterface />);

    expect(screen.getByTestId('skeleton-chat')).toBeTruthy();
    expect(screen.queryByTestId('chat-messages')).toBeNull();
  });

  it('renders the conversation (not the skeleton) once messages have loaded', () => {
    mockChatState.isLoading = false;
    mockChatState.messages = [
      { id: '1', role: 'assistant', content: 'hello', timestamp: new Date() },
    ];

    render(<StellarChatInterface />);

    expect(screen.getByTestId('chat-messages')).toBeTruthy();
    expect(screen.queryByTestId('skeleton-chat')).toBeNull();
  });
});
