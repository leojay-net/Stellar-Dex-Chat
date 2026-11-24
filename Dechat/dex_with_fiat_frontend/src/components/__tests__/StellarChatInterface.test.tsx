import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StellarChatInterface from '@/components/StellarChatInterface';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
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
    messages: [] as {
      id: string;
      role: string;
      content: string;
      timestamp: Date;
    }[],
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

const mockUseOnlineStatus = vi.fn(() => ({
  isOnline: true,
  wasOffline: false,
  resetWasOffline: vi.fn(),
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

const mockAddToast = vi.fn();

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
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
vi.mock('@/components/WalletConnectionTimeline', () => ({
  default: () => null,
}));
vi.mock('@/components/ReceiptDrawerWrapper', () => ({ default: () => null }));
vi.mock('@/components/ui/skeleton/SkeletonChat', () => ({
  default: () => null,
}));
vi.mock('@/components/ui/skeleton/SkeletonSidebar', () => ({
  default: () => null,
}));
let mockNotificationsCenterThrows = true;

vi.mock('@/components/NotificationsCenterWrapper', () => ({
  default: () => {
    if (mockNotificationsCenterThrows) {
      throw new Error('notifications test throw');
    }
    return null;
  },
}));
vi.mock('@/components/StellarFiatModalWrapper', () => ({
  default: () => null,
}));
vi.mock('@/components/BankDetailsModalWrapper', () => ({
  default: () => null,
}));
vi.mock('@/components/UserSettingsWrapper', () => ({ default: () => null }));
vi.mock('@/components/SplitViewComparisonWrapper', () => ({
  default: () => null,
}));
vi.mock('@/components/ChatSearchPanelWrapper', () => ({ default: () => null }));
vi.mock('@/components/NetworkStatusModalWrapper', () => ({
  default: () => null,
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
    // Reset useOnlineStatus mock to default
    mockUseOnlineStatus.mockReturnValue({
      isOnline: true,
      wasOffline: false,
      resetWasOffline: vi.fn(),
    });
    // Reset NotificationsCenterWrapper to throw error by default
    mockNotificationsCenterThrows = true;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the top-level interface error UI when a header child throws', () => {
    // Default behavior: NotificationsCenterWrapper throws error
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(<StellarChatInterface />);

    expect(screen.getByText('common.error_boundary_title')).toBeTruthy();
    expect(screen.getByText('common.error_boundary_message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('renders correctly when offline at load without hydration mismatch', () => {
    // Override mock for this test
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      wasOffline: false,
      resetWasOffline: vi.fn(),
    });
    // Allow NotificationsCenterWrapper to render normally
    mockNotificationsCenterThrows = false;

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    render(<StellarChatInterface />);

    // Verify offline banner is shown
    expect(screen.getByText('common.offline_detected')).toBeTruthy();

    // Verify no hydration warning was logged
    const hydrationWarnings = consoleWarnSpy.mock.calls.filter(
      (call: unknown[]) => call[0]?.toString().includes('hydration'),
    );
    expect(hydrationWarnings).toHaveLength(0);

    consoleWarnSpy.mockRestore();
  });

  describe('network status toast', () => {
    beforeEach(() => {
      mockNotificationsCenterThrows = false;
    });

    const setOnline = (isOnline: boolean) =>
      mockUseOnlineStatus.mockReturnValue({
        isOnline,
        wasOffline: false,
        resetWasOffline: vi.fn(),
      });

    it('does not toast when mounting online', () => {
      render(<StellarChatInterface />);

      expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('toasts a warning when mounting offline', () => {
      setOnline(false);
      render(<StellarChatInterface />);

      expect(mockAddToast).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'common.offline_detected',
          variant: 'warning',
        }),
      );
    });

    it('toasts once when the connection drops and once when it returns', () => {
      const { rerender } = render(<StellarChatInterface />);

      setOnline(false);
      rerender(<StellarChatInterface />);
      rerender(<StellarChatInterface />);

      expect(mockAddToast).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: 'common.offline_detected',
          variant: 'warning',
        }),
      );

      setOnline(true);
      rerender(<StellarChatInterface />);
      rerender(<StellarChatInterface />);

      expect(mockAddToast).toHaveBeenCalledTimes(2);
      expect(mockAddToast).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: 'common.online',
          variant: 'success',
        }),
      );
    });

    it('keeps the inline offline status alongside the toast', () => {
      setOnline(false);
      render(<StellarChatInterface />);

      expect(screen.getByText('common.offline_detected')).toBeTruthy();
    });
  });
});
