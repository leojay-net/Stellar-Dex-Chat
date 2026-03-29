'use client';

import SkeletonChat from '@/components/ui/skeleton/SkeletonChat';
import SkeletonSidebar from '@/components/ui/skeleton/SkeletonSidebar';
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Wallet,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  Plus,
  Star,
  Settings,
  ChevronDown,
  User,
  AlertCircle,
  RefreshCcw,
  Receipt,
} from 'lucide-react';
import {
    EXPECTED_NETWORK,
    useStellarWallet,
} from '@/contexts/StellarWalletContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import useBridgeStats from '@/hooks/useBridgeStats';
import useChat from '@/hooks/useChat';
import { getQueuedReadRequestsCount } from '@/lib/networkQueue';
import { getAdmin, stroopsToDisplay } from '@/lib/stellarContract';
import { TransactionData } from '@/types';
import BankDetailsModal from './BankDetailsModal';
import ChatHistorySidebar from './ChatHistorySidebar';
import ChatInput from './ChatInput';
import ChatMessages from './ChatMessages';
import NotificationsCenter from './NotificationsCenter';
import StellarFiatModal from './StellarFiatModal';
import UserSettings from './UserSettings';
import WalletConnectionTimeline from './WalletConnectionTimeline';
import { clearExpiredDrafts } from '@/lib/draftUtils';
import { useTranslation } from '@/contexts/TranslationContext';
import ReceiptDrawer from './ReceiptDrawerWrapper';
import { useTxHistory } from '@/hooks/useTxHistory';
import {
  subscribeToQueue,
  processQueue,
} from '@/lib/networkQueue';

export default function StellarChatInterface() {
  const { t } = useTranslation();
  const {
    connection,
    connect,
    disconnect,
    accounts,
    selectedAccountIndex,
    selectAccount,
    sessionExpired,
    clearSessionExpired,
    isNetworkMismatch,
    error: walletError,
  } = useStellarWallet();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { fiatCurrency } = useUserPreferences();

  const [showSidebar, setShowSidebar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [defaultAmount, setDefaultAmount] = useState('');
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankDetailsXlmAmount, setBankDetailsXlmAmount] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isSheetMounted, setIsSheetMounted] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof window !== 'undefined' ? window.navigator.onLine : true,
  );
  const [queuedReadables, setQueuedReadables] = useState(
    getQueuedReadRequestsCount(),
  );
  const [isReceiptDrawerOpen, setIsReceiptDrawerOpen] = useState(false);
  const { entries: txHistory, clearEntries: clearTxHistory } = useTxHistory();
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  const sheetRef = useRef<HTMLDivElement>(null);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    messages,
    isLoading,
    sendMessage,
    cancelPendingRequest,
    clearChat,
    loadChatSession,
    currentSessionId,
    setTransactionReadyCallback,
    setIsAdmin: setChatIsAdmin,
  } = useChat();

  const {
    balance,
    limit,
    totalDeposited,
    loading: statsLoading,
    error: statsError,
  } = useBridgeStats();

  // Track viewport width to switch between sidebar and drawer
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      void processQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = subscribeToQueue((count) => {
      setQueuedReadables(count);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  // Clear expired drafts on initial mount
  useEffect(() => {
    clearExpiredDrafts();
  }, []);

  // Check if current user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (connection.isConnected && connection.address) {
        try {
          const adminAddr = await getAdmin();
          setIsAdmin(adminAddr === connection.address);
        } catch (err: unknown) {
          console.error(
            'Failed to check admin role:',
            err instanceof Error ? err.message : 'Unknown error',
          );
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, [connection.isConnected, connection.address]);

  // Sync admin state to chat hook
  useEffect(() => {
    setChatIsAdmin(isAdmin);
  }, [isAdmin, setChatIsAdmin]);

  // On viewport change, close whichever panel is open to avoid stale state
  useEffect(() => {
    setShowSidebar(false);
    setIsSheetMounted(false);
  }, [isMobile]);

  // Mount the bottom-sheet when the user opens it on mobile
  useEffect(() => {
    if (showSidebar && isMobile) {
      setIsSheetMounted(true);
    }
  }, [showSidebar, isMobile]);

  // Slide the drawer in after it mounts
  useEffect(() => {
    if (!isSheetMounted || !sheetRef.current) return;
    const el = sheetRef.current;
    el.style.transform = 'translateX(-100%)';
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      el.style.transform = 'translateX(0)';
    });
    return () => cancelAnimationFrame(raf);
  }, [isSheetMounted]);

  // Focus the sheet for keyboard/screen-reader users
  useEffect(() => {
    if (isSheetMounted && sheetRef.current) {
      sheetRef.current.focus();
    }
  }, [isSheetMounted]);

  // Dismiss on Escape key
  useEffect(() => {
    if (!isSheetMounted) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // closeSheet is stable (useCallback with no deps that change), safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSheetMounted]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        accountDropdownRef.current &&
        !accountDropdownRef.current.contains(event.target as Node)
      ) {
        setShowAccountDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const closeSheet = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transition =
        'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      sheetRef.current.style.transform = 'translateX(-100%)';
    }
    closeTimerRef.current = setTimeout(() => {
      setIsSheetMounted(false);
      setShowSidebar(false);
    }, 300);
  }, []);



  // When the AI decides a transaction is ready, open the modal
  const handleTransactionReady = useCallback(
    (data: TransactionData) => {
      if (isNetworkMismatch) return;
      if (data.amountIn) setDefaultAmount(data.amountIn);
      setIsAdminMode(false);
      setShowModal(true);
    },
    [isNetworkMismatch],
  );

  // After a successful deposit, close the deposit modal and open bank details
  const handleDepositSuccess = useCallback(
    (result: { xlmAmount: number; note?: string }) => {
      setShowModal(false);
      setDefaultAmount('');
      setBankDetailsXlmAmount(result.xlmAmount);
      setShowBankDetails(true);
    },
    [],
  );

  // Register the callback in useEffect to ensure it runs reliably
  useEffect(() => {
    setTransactionReadyCallback(handleTransactionReady);
  }, [handleTransactionReady, setTransactionReadyCallback]);

  const handleActionClick = useCallback(
    (actionId: string, actionType: string, data?: Record<string, unknown>) => {
      switch (actionType) {
        case 'connect_wallet':
          connect();
          break;
        case 'confirm_fiat':
          if (isNetworkMismatch) break;
          setIsAdminMode(false);
          setShowModal(true);
          break;
        case 'query':
          if (data?.query) {
            sendMessage(data.query as string);
          }
          break;
        case 'check_portfolio':
          sendMessage('Show me my XLM portfolio and balance');
          break;
        case 'market_rates':
          sendMessage(
            'What are the current XLM market rates and conversion estimates?',
          );
          break;
        case 'learn_more':
          sendMessage('How does the Stellar FiatBridge work?');
          break;
        case 'cancel':
          sendMessage('Cancel the current transaction');
          break;
        default:
          break;
      }
    },
    [connect, isNetworkMismatch, sendMessage],
  );

  return (
    <div className="theme-app flex h-screen w-screen overflow-hidden transition-colors duration-300">
      {/* Desktop sidebar - only rendered on lg+ viewports or when toggled */}
      {!isMobile && (
        <div className={`shrink-0 transition-all duration-300 ${showSidebar ? 'w-72' : 'w-20'}`}>
          {isLoading ? (
            <SkeletonSidebar />
          ) : (
            <ChatHistorySidebar
              isCollapsed={!showSidebar}
              onLoadSession={(id) => {
                loadChatSession(id);
              }}
            />
          )}
        </div>
      )}
      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="theme-surface theme-border flex-shrink-0 flex items-center justify-between px-4 py-3 border-b transition-colors duration-300">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              {showSidebar ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Star className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  {t('header.title')}
                </h1>
                <p
                  className={`text-xs leading-none mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                >
                  {t('header.subtitle')}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              title={t('header.new_chat_title')}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Plus className="w-5 h-5" />
            </button>

            <NotificationsCenter />

            <button
              onClick={() => setIsReceiptDrawerOpen(true)}
              title={t('header.receipts')}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Receipt className="w-5 h-5" />
            </button>

            <button
              onClick={() => setShowSettings(true)}
              title={t('header.settings_title')}
              aria-label={t('header.settings_aria_label')}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Settings className="w-5 h-5" />
            </button>

            <button
              onClick={toggleDarkMode}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              {isDarkMode ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>

            {connection.isConnected ? (
              <div className="flex items-center gap-2">
                <div ref={accountDropdownRef} className="relative">
                  <button
                    onClick={() =>
                      accounts.length > 1 &&
                      setShowAccountDropdown(!showAccountDropdown)
                    }
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode ? 'bg-gray-800 text-gray-200 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} ${accounts.length > 1 ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="font-mono">
                      {connection.address.slice(0, 6)}…
                      {connection.address.slice(-4)}
                    </span>
                    {accounts.length > 1 && (
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${showAccountDropdown ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>
                  {showAccountDropdown && accounts.length > 1 && (
                    <div
                      className={`absolute right-0 top-full mt-1 w-56 rounded-lg shadow-lg border z-50 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                    >
                      <div
                        className={`px-3 py-2 text-xs font-semibold border-b ${isDarkMode ? 'text-gray-400 border-gray-700' : 'text-gray-500 border-gray-200'}`}
                      >
                        {t('header.switch_account')}
                      </div>
                      {accounts.map((account, idx) => (
                        <button
                          key={account.address}
                          onClick={() => {
                            selectAccount(idx);
                            setShowAccountDropdown(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${idx === selectedAccountIndex ? (isDarkMode ? 'bg-blue-900/50 text-blue-400' : 'bg-blue-50 text-blue-600') : isDarkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                          <User className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="font-mono truncate">
                            {account.address.slice(0, 6)}…
                            {account.address.slice(-4)}
                          </span>
                          {idx === selectedAccountIndex && (
                            <span
                              className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-blue-900/50' : 'bg-blue-100'}`}
                            >
                              {t('header.active_account')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={disconnect}
                  title={t('header.disconnect_title')}
                  className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={connect}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-lg transition-all"
              >
                <Wallet className="w-4 h-4" />
                {t('header.connect_freighter')}
              </button>
            )}
          </div>
        </header>

        {walletError && (
          <div
            className="flex-shrink-0 justify-center py-2 px-4 text-sm font-medium text-red-100 bg-red-500/90"
            role="alert"
            aria-live="polite"
          >
            {walletError}
          </div>
        )}

        {/* Network status */}
        {(!isOnline || queuedReadables > 0) && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-2 text-xs border-b transition-all duration-300 ${
              !isOnline
                ? 'bg-amber-100 border-amber-200 text-amber-800'
                : 'bg-blue-50 border-blue-100 text-blue-800'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              {!isOnline ? (
                <AlertCircle className="w-4 h-4 animate-pulse" />
              ) : (
                <RefreshCcw className="w-4 h-4 animate-spin" />
              )}
              <span>
                {!isOnline ? t('common.offline_detected') : t('common.online')}
                {queuedReadables > 0 &&
                  ` (${queuedReadables} ${t('common.queued')})`}
              </span>
            </div>
            {queuedReadables > 0 && isOnline && (
              <button
                onClick={() => void processQueue()}
                className="px-2 py-1 bg-white/50 hover:bg-white/80 rounded border border-current font-medium transition-colors"
              >
                {t('common.retry_now')}
              </button>
            )}
          </div>
        )}

        {/* Network badge */}
        {connection.isConnected && (
          <div
            className={`flex-shrink-0 flex flex-col items-center gap-1 py-1.5 text-xs ${
              isNetworkMismatch
                ? isDarkMode ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700'
                : isDarkMode
                  ? 'bg-gray-800/50 text-gray-400'
                  : 'bg-gray-50 text-gray-700'
            }`}
            role="status"
            aria-live="polite"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  isNetworkMismatch ? 'bg-red-500' : 'bg-green-500'
                }`}
              />
              {t('common.network')}:{' '}
              <span
                className={`font-medium ${
                  isNetworkMismatch ? (isDarkMode ? 'text-red-400' : 'text-red-700') : (isDarkMode ? 'text-blue-400' : 'text-blue-700')
                }`}
              >
                {connection.network || t('common.unknown')}
              </span>
              {isNetworkMismatch && (
                <span className="font-semibold">
                  ({t('common.expected')} {EXPECTED_NETWORK})
                </span>
              )}
              {!isNetworkMismatch && (
                <>
                  {' · '}
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => {
                          setIsAdminMode(true);
                          setShowModal(true);
                        }}
                        className="text-blue-400 hover:text-blue-300 underline"
                      >
                        {t('common.withdraw_xlm')}
                      </button>
                      {' · '}
                    </>
                  )}
                  <button
                    onClick={() => {
                      setIsAdminMode(false);
                      setShowModal(true);
                    }}
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    {t('common.deposit_xlm')}
                  </button>
                </>
              )}
            </span>
            {isNetworkMismatch && (
              <span className="flex items-center gap-1 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5" />
                {t('common.network_mismatch_warning', { expectedNetwork: EXPECTED_NETWORK })}
              </span>
            )}
          </div>
        )}

        {/* Bridge Stats Bar */}
        {connection.isConnected && (
          <div
            className={`flex-shrink-0 py-2 px-4 text-xs ${
              isDarkMode
                ? 'bg-gray-800/30 text-gray-300'
                : 'bg-gray-100 text-gray-700'
            }`}
            role="status"
            aria-live="polite"
          >
            {statsError ? (
              <span className="text-red-400">{statsError}</span>
            ) : statsLoading ? (
              <span className="text-gray-500">{t('common.loading_stats')}</span>
            ) : (
              <div className="flex flex-col gap-1 sm:flex-row sm:gap-4 sm:items-center">
                <span className="font-medium">
                  {t('common.bridge_balance')}:{' '}
                  <span className={isDarkMode ? 'text-blue-400' : 'text-blue-700'}>
                    {balance !== null ? stroopsToDisplay(balance) : '—'} XLM
                  </span>
                </span>
                <span className="font-medium">
                  {t('common.deposit_limit')}:{' '}
                  <span className={isDarkMode ? 'text-blue-400' : 'text-blue-700'}>
                    {limit !== null ? stroopsToDisplay(limit) : '—'} XLM
                  </span>
                </span>
                <span className="font-medium">
                  Total Deposited:{' '}
                  <span className={isDarkMode ? 'text-blue-400' : 'text-blue-700'}>
                    {totalDeposited !== null
                      ? stroopsToDisplay(totalDeposited)
                      : '—'}{' '}
                    XLM
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 min-h-0 flex flex-col">
          {isLoading && messages.length === 0 ? (
            <SkeletonChat />
          ) : (
            <ChatMessages
              messages={messages}
              onActionClick={handleActionClick}
              isLoading={isLoading}
            />
          )}
          <ChatInput
            onSendMessage={sendMessage}
            onCancelRequest={cancelPendingRequest}
            onNewChat={clearChat}
            onOpenHistory={() => setShowSidebar(true)}
            onOpenBridgeModal={() => {
              setIsAdminMode(false);
              setShowModal(true);
            }}
            isLoading={isLoading}
            sessionId={currentSessionId}
            placeholder="Ask about XLM rates, deposit, or anything Stellar…"
          />
          <div className="px-6 pb-4">
            <WalletConnectionTimeline
              isConnected={connection.isConnected}
              isNetworkMismatch={isNetworkMismatch}
              isConnecting={false}
              contextMode={isAdmin ? 'advanced' : 'simple'}
              onRetry={connect}
            />
          </div>
        </div>
      </div>

      {/* Mobile slide-out drawer - only rendered when isSheetMounted */}
      {isSheetMounted && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={closeSheet}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Chat history"
            tabIndex={-1}
            className={`fixed top-0 left-0 bottom-0 w-80 z-[70] flex flex-col will-change-transform focus:outline-none ${
              isDarkMode ? 'bg-gray-900 border-r border-gray-800' : 'bg-white border-r border-gray-200'
            }`}
          >
            <ChatHistorySidebar
              onLoadSession={(id) => {
                loadChatSession(id);
                closeSheet();
              }}
              onClose={closeSheet}
            />
          </div>
        </>
      )}

      {/* Deposit / Withdraw Modal */}
      <StellarFiatModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setDefaultAmount('');
          setIsAdminMode(false);
        }}
        isAdminMode={isAdminMode}
        defaultAmount={defaultAmount}
        fiatCurrency={fiatCurrency}
        onDepositSuccess={handleDepositSuccess}
        messages={messages}
      />

      {/* Bank details & fiat payout modal */}
      <BankDetailsModal
        isOpen={showBankDetails}
        onClose={() => setShowBankDetails(false)}
        xlmAmount={bankDetailsXlmAmount}
      />

      {/* Settings panel */}
      <UserSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Receipt Drawer */}
      <ReceiptDrawer
        isOpen={isReceiptDrawerOpen}
        onClose={() => setIsReceiptDrawerOpen(false)}
        transactions={txHistory}
        onClearHistory={clearTxHistory}
      />

      {/* Session expired banner */}
      {sessionExpired && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
          <div
            className={`flex items-center gap-3 p-4 rounded-lg shadow-lg border ${isDarkMode ? 'bg-gray-800 border-yellow-600/50' : 'bg-white border-yellow-500'}`}
          >
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
              >
                Wallet Session Expired
              </p>
              <p
                className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
              >
                Your wallet session has expired after 24 hours. Please reconnect
                to continue.
              </p>
            </div>
            <button
              onClick={() => {
                clearSessionExpired();
                connect();
              }}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors"
            >
              Reconnect
            </button>
            <button
              onClick={clearSessionExpired}
              className={`flex-shrink-0 p-1 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
