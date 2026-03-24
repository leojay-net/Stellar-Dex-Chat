'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Wallet, LogOut, Moon, Sun, Menu, X, Plus, Star } from 'lucide-react';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { useTheme } from '@/contexts/ThemeContext';
import useChat from '@/hooks/useChat';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import ChatHistorySidebar from './ChatHistorySidebar';
import StellarFiatModal from './StellarFiatModal';
import BankDetailsModal from './BankDetailsModal';
import { TransactionData } from '@/types';
import SkeletonChat from '@/components/ui/skeleton/SkeletonChat';
import SkeletonSidebar from '@/components/ui/skeleton/SkeletonSidebar';

export default function StellarChatInterface() {
  const { connection, connect, disconnect } = useStellarWallet();
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [showSidebar, setShowSidebar] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [defaultAmount, setDefaultAmount] = useState('');
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankDetailsXlmAmount, setBankDetailsXlmAmount] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isSheetMounted, setIsSheetMounted] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    loadChatSession,
    setTransactionReadyCallback,
  } = useChat();

  // Track viewport width to switch between sidebar and bottom-sheet
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

  // Slide the sheet up after it mounts
  useEffect(() => {
    if (!isSheetMounted || !sheetRef.current) return;
    const el = sheetRef.current;
    el.style.transform = 'translateY(100%)';
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      el.style.transform = 'translateY(0)';
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

  const closeSheet = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transition =
        'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      sheetRef.current.style.transform = 'translateY(100%)';
    }
    closeTimerRef.current = setTimeout(() => {
      setIsSheetMounted(false);
      setShowSidebar(false);
    }, 300);
  }, []);

  const handleSheetTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      dragStartY.current = e.touches[0].clientY;
      dragDelta.current = 0;
      isDragging.current = true;
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'none';
      }
    },
    [],
  );

  const handleSheetTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!isDragging.current || !sheetRef.current) return;
      const delta = e.touches[0].clientY - dragStartY.current;
      dragDelta.current = delta;
      // Only allow downward drag
      if (delta > 0) {
        sheetRef.current.style.transform = `translateY(${delta}px)`;
      }
    },
    [],
  );

  const handleSheetTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragDelta.current > 120) {
      closeSheet();
    } else if (sheetRef.current) {
      sheetRef.current.style.transition =
        'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      sheetRef.current.style.transform = 'translateY(0)';
    }
    dragDelta.current = 0;
  }, [closeSheet]);

  // When the AI decides a transaction is ready, open the modal
  const handleTransactionReady = useCallback((data: TransactionData) => {
    if (data.amountIn) setDefaultAmount(data.amountIn);
    setShowModal(true);
  }, []);

  // After a successful deposit, close the deposit modal and open bank details
  const handleDepositSuccess = useCallback((xlmAmount: number) => {
    setShowModal(false);
    setDefaultAmount('');
    setBankDetailsXlmAmount(xlmAmount);
    setShowBankDetails(true);
  }, []);

  // Register the callback once
  useState(() => {
    setTransactionReadyCallback(handleTransactionReady);
  });

  const handleActionClick = useCallback(
    (actionId: string, actionType: string) => {
      switch (actionType) {
        case 'connect_wallet':
          connect();
          break;
        case 'confirm_fiat':
          setShowModal(true);
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
    [connect, sendMessage],
  );

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}
    >
      {/* Desktop sidebar — only rendered on md+ viewports */}
      {!isMobile && showSidebar && (
        <div className="shrink-0 w-72">
          {isLoading ? (
            <SkeletonSidebar />
          ) : (
            <ChatHistorySidebar
              onLoadSession={(id) => {
                loadChatSession(id);
                setShowSidebar(false);
              }}
            />
          )}
        </div>
      )}
      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header
          className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b transition-colors duration-300 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
        >
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
                <p className="font-semibold text-sm leading-none">
                  DexFiat · Stellar
                </p>
                <p
                  className={`text-xs leading-none mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                >
                  AI-Powered XLM-to-Fiat
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              title="New chat"
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Plus className="w-5 h-5" />
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
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
                >
                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="font-mono">
                    {connection.address.slice(0, 6)}…
                    {connection.address.slice(-4)}
                  </span>
                </div>
                <button
                  onClick={disconnect}
                  title="Disconnect"
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
                Connect Freighter
              </button>
            )}
          </div>
        </header>

        {/* Network badge */}
        {connection.isConnected && (
          <div
            className={`flex-shrink-0 flex justify-center py-1 text-xs ${isDarkMode ? 'bg-gray-800/50 text-gray-400' : 'bg-gray-50 text-gray-500'}`}
          >
            <span>
              Network:{' '}
              <span className="font-medium text-blue-400">
                {connection.network || 'TESTNET'}
              </span>
              {' · '}
              <button
                onClick={() => setShowModal(true)}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Deposit XLM
              </button>
            </span>
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
            isLoading={isLoading}
            placeholder="Ask about XLM rates, deposit, or anything Stellar…"
          />
        </div>
      </div>

      {/* Mobile bottom-sheet — only rendered when isSheetMounted */}
      {isSheetMounted && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closeSheet}
            aria-hidden="true"
          />

          {/* Sheet */}
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Chat history"
            tabIndex={-1}
            className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl max-h-[85svh] will-change-transform focus:outline-none ${
              isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
          >
            {/* Drag handle */}
            <div
              className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing"
              aria-hidden="true"
            >
              <div
                className={`w-10 h-1 rounded-full ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
              />
            </div>

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
        }}
        defaultAmount={defaultAmount}
        onDepositSuccess={handleDepositSuccess}
      />

      {/* Bank details & fiat payout modal */}
      <BankDetailsModal
        isOpen={showBankDetails}
        onClose={() => setShowBankDetails(false)}
        xlmAmount={bankDetailsXlmAmount}
      />
    </div>
  );
}
