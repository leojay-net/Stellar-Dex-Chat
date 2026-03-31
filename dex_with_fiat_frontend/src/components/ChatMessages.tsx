'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage } from '@/types';
import { useTheme } from '@/contexts/ThemeContext';
import {
  Wallet,
  ArrowDownCircle,
  CreditCard,
  X,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import Message from './Message';
import { useChatPagination } from '@/hooks/useChatPagination';
import Skeleton from '@/components/ui/skeleton/Skeleton';

interface ChatMessagesProps {
  messages: ChatMessage[];
  onActionClick: (
    actionId: string,
    actionType: string,
    data?: Record<string, unknown>,
  ) => void;
  isLoading?: boolean;
}

interface HelpCardProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: (id: string) => void;
  isDarkMode: boolean;
}

function HelpCard({
  id,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  onDismiss,
  isDarkMode,
}: HelpCardProps) {
  return (
    <div
      className={`relative group p-5 rounded-2xl border transition-all duration-300 transform hover:-translate-y-1 hover:shadow-xl ${isDarkMode
          ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500/50'
          : 'bg-white border-gray-100 hover:border-blue-200'
        }`}
    >
      <button
        onClick={() => onDismiss(id)}
        className={`absolute top-3 right-3 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode
            ? 'hover:bg-gray-700 text-gray-500 hover:text-gray-300'
            : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'
          }`}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex flex-col h-full">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${isDarkMode
              ? 'bg-blue-500/10 text-blue-400'
              : 'bg-blue-50 text-blue-600'
            }`}
        >
          {icon}
        </div>

        <h3
          className={`text-base font-semibold mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'
            }`}
        >
          {title}
        </h3>

        <p
          className={`text-sm leading-relaxed mb-6 flex-grow ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
        >
          {description}
        </p>

        <button
          onClick={onAction}
          className={`flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${isDarkMode
              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200'
            }`}
        >
          {actionLabel}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function ChatMessages({
  messages: allMessages,
  onActionClick,
  isLoading = false,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const { isDarkMode } = useTheme();

  const { visibleMessages, hasMore, isLoadingMore, loadMore } =
    useChatPagination(allMessages);

  const [dismissedCards, setDismissedCards] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [prevScrollHeight, setPrevScrollHeight] = useState(0);
  const [shouldPreserveScroll, setShouldPreserveScroll] = useState(false);
  
  // Track messages that have already been rendered to avoid re-animating
  const seenMessageIds = useRef<Set<string>>(new Set());
  const [isReadyToAnimate, setIsReadyToAnimate] = useState(false);

  // Load dismissed cards from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dexfiat_dismissed_help_cards');
    if (saved) {
      try {
        setDismissedCards(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse dismissed cards', e);
      }
    }
    
    // Mark initial messages as seen
    allMessages.forEach(m => seenMessageIds.current.add(m.id));
    
    setIsLoaded(true);
    // Delay setting isReadyToAnimate to ensure initial history is processed
    const timer = setTimeout(() => setIsReadyToAnimate(true), 100);
    return () => clearTimeout(timer);
  }, [allMessages]);

  // Update seen messages whenever visibleMessages changes, but don't trigger re-render
  useEffect(() => {
    if (isReadyToAnimate && !isLoadingMore) {
      visibleMessages.forEach(m => seenMessageIds.current.add(m.id));
    }
  }, [visibleMessages, isReadyToAnimate, isLoadingMore]);

  const dismissCard = (id: string) => {
    const updated = [...dismissedCards, id];
    setDismissedCards(updated);
    localStorage.setItem(
      'dexfiat_dismissed_help_cards',
      JSON.stringify(updated),
    );
  };

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    if (isLoading || allMessages.length > 0) {
      // Only auto-scroll to bottom if we are NOT loading more previous messages
      if (!isLoadingMore && !shouldPreserveScroll) {
        const timer = setTimeout(() => {
          scrollToBottom();
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [allMessages.length, isLoading, isLoadingMore, shouldPreserveScroll, scrollToBottom]);

  // Handle scroll preservation when loading more
  useEffect(() => {
    if (isLoadingMore) {
      if (containerRef.current) {
        setPrevScrollHeight(containerRef.current.scrollHeight);
        setShouldPreserveScroll(true);
      }
    }
  }, [isLoadingMore]);

  useEffect(() => {
    if (shouldPreserveScroll && !isLoadingMore && containerRef.current) {
      const newHeight = containerRef.current.scrollHeight;
      const heightDiff = newHeight - prevScrollHeight;
      if (heightDiff > 0) {
        containerRef.current.scrollTop = heightDiff;
      }
      setShouldPreserveScroll(false);
    }
  }, [visibleMessages.length, isLoadingMore, shouldPreserveScroll, prevScrollHeight]);

  // Intersection Observer for Infinite Scroll
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.5 }
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMore]);

  const helpCards = [
    {
      id: 'wallet',
      icon: <Wallet className="w-6 h-6" />,
      title: 'Connect Wallet',
      description:
        'Connect your Freighter wallet to securely sign transactions on the Stellar network.',
      actionLabel: 'Connect Now',
      onAction: () => onActionClick('connect', 'connect_wallet'),
    },
    {
      id: 'deposit',
      icon: <ArrowDownCircle className="w-6 h-6" />,
      title: 'Deposit XLM',
      description:
        'Lock your XLM assets into our secure bridge contract to initiate a conversion to fiat.',
      actionLabel: 'Start Deposit',
      onAction: () => onActionClick('deposit', 'confirm_fiat'),
    },
    {
      id: 'payout',
      icon: <CreditCard className="w-6 h-6" />,
      title: 'Setup Payout',
      description:
        'Configure your local bank details to receive Naira or USD once your deposit is confirmed.',
      actionLabel: 'Setup Bank',
      onAction: () =>
        onActionClick('payout_guide', 'query', {
          query: 'How do I setup my bank details for payout?',
        }),
    },
  ];

  const visibleCards = helpCards.filter(
    (card) => !dismissedCards.includes(card.id),
  );

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-y-auto p-6 transition-colors duration-300 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
        }`}
      style={{
        height: '100%',
        minHeight: '0',
        maxHeight: '100%',
      }}
    >
      {visibleMessages.length === 0 ? (
        <div className="max-w-4xl mx-auto h-full flex flex-col items-center justify-center py-12">
          {/* Welcome Header */}
          <div className="text-center mb-12">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4 ${isDarkMode
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-blue-50 text-blue-600'
                }`}
            >
              <Sparkles className="w-3 h-3" />
              AI-Powered Bridge
            </div>
            <h1
              className={`text-4xl font-bold mb-4 tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}
            >
              Welcome to <span className="text-blue-600">DexFiat</span>
            </h1>
            <p
              className={`text-lg max-w-xl mx-auto leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
            >
              The most intuitive way to convert your Stellar assets to fiat
              currency. Follow the steps below to get started.
            </p>
          </div>

          {/* Help Cards Grid */}
          {isLoaded && visibleCards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
              {visibleCards.map((card) => (
                <HelpCard
                  key={card.id}
                  {...card}
                  onDismiss={dismissCard}
                  isDarkMode={isDarkMode}
                />
              ))}
            </div>
          )}

          {/* No cards left placeholder or simple message */}
          {isLoaded && visibleCards.length === 0 && (
            <div
              className={`text-center animate-in fade-in duration-500 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}
            >
              <p>Type a message below to start your conversion journey.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6 pb-6 max-w-4xl mx-auto">
          {/* Loading indicator for pagination */}
          {hasMore && (
            <div
              ref={loaderRef}
              className="flex justify-center py-4 text-gray-500"
            >
              {isLoadingMore ? (
                <div className="w-full space-y-3 px-2 animate-in fade-in" aria-label="Loading older messages">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-1/4" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs opacity-0">Scroll up to load more</span>
              )}
            </div>
          )}

          {visibleMessages.map((message: ChatMessage) => (
            <Message
              key={message.id}
              message={message}
              onActionClick={onActionClick}
              shouldAnimate={isReadyToAnimate && !isLoadingMore && !seenMessageIds.current.has(message.id)}
            />
          ))}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
