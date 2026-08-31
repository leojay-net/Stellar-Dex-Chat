'use client';

import { useMemo } from 'react';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useMasking } from '@/hooks/useMasking';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import { ChatMessage } from '@/types';
import { AlertTriangle, Bot, Check, CheckCheck, Clock, Coins, Link, RotateCcw, User, Loader2, RefreshCcw, XCircle } from 'lucide-react';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { toDate } from '@/lib/messageUtils';
import { MAX_AUTO_RETRIES, useMessageRetry } from '@/hooks/useMessageRetry';
import { useTranslation } from '@/contexts/TranslationContext';
import { motion, useReducedMotion } from 'framer-motion';
import CopyButton from '@/components/ui/CopyButton';

interface MessageProps {
  message: ChatMessage;
  onActionClick: (
    actionId: string,
    actionType: string,
    data?: Record<string, unknown>,
  ) => void;
  /**
   * Resend a message that failed to send. Receives the message id and the
   * *original* content the user typed (from `originalPayload` when available),
   * so the caller never has to reconstruct it and the user never has to retype.
   */
  onRetry?: (messageId: string, content: string) => void | Promise<void>;
  shouldAnimate?: boolean;
}

export default function Message({ message, onActionClick, onRetry, shouldAnimate = false }: MessageProps) {
  const { connection } = useStellarWallet();
  const { isDarkMode } = useTheme();
  const { maskingEnabled, maskingStyle } = useUserPreferences();
  const isUser = message.role === 'user';
  const hasError = !!message.error;
  const shouldReduceMotion = useReducedMotion();

  // Apply masking to message content
  const maskedContent = useMasking(message.content, {
    enabled: maskingEnabled,
    style: maskingStyle,
  });
  const { t } = useTranslation();
  const isPending = message.metadata?.status === 'pending';
  const isFailed = message.metadata?.status === 'failed';

  // Resend uses the payload captured at send time so the user's original text
  // survives any post-failure rewrite of `content`.
  const retryContent = message.originalPayload?.content ?? message.content;
  const retry = useMessageRetry({
    messageId: message.id,
    content: retryContent,
    isFailed: hasError,
    onRetry,
  });
  // Attempts already recorded on the message, plus the ones this component has
  // made since it mounted.
  const totalRetryAttempts = (message.error?.retryAttempts ?? 0) + retry.attempts;

  // Currency conversion hook for transaction amounts
  const amountForConversion = message.metadata?.transactionData?.amountIn 
    ? parseFloat(String(message.metadata.transactionData.amountIn))
    : undefined;
  const tokenForConversion = message.metadata?.transactionData?.tokenIn || 'XLM';
  const { displayText: conversionDisplayText } = useCurrencyConversion(
    amountForConversion,
    tokenForConversion,
  );



  const variants = {
    initial: { 
      opacity: 0, 
      y: shouldReduceMotion ? 0 : 20,
      scale: shouldReduceMotion ? 1 : 0.95
    },
    animate: { 
      opacity: 1, 
      y: 0,
      scale: 1,
      transition: {
        duration: 0.4,
        ease: [0.23, 1, 0.32, 1] as const // Custom cubic-bezier for premium feel
      }
    }
  };

  // Memoize the ReactMarkdown components map so it is stable across renders.
  // Recreating this object on every render causes the entire markdown subtree
  // to unmount and remount, which is the source of the UI glitch / memory leak.
  const markdownComponents = useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
      strong: ({ children }) => (
        <strong className="font-bold">{children}</strong>
      ),
      em: ({ children }) => <em className="italic">{children}</em>,
      ul: ({ children }) => (
        <ul className="list-disc list-inside mb-2">{children}</ul>
      ),
      li: ({ children }) => <li className="mb-1">{children}</li>,
      code: ({ children }) => (
        <code
          className={`px-1 py-0.5 rounded text-xs font-mono ${isDarkMode
            ? 'bg-gray-700 text-gray-200'
            : 'bg-gray-200 text-gray-800'
            }`}
        >
          {children}
        </code>
      ),
      h1: ({ children }) => (
        <h1 className="text-lg font-bold mb-2">{children}</h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-base font-bold mb-2">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-sm font-bold mb-1">{children}</h3>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          {children}
        </a>
      ),
    }),
    [isDarkMode],
  );

  // Safely parse the timestamp — guards against deserialized string values
  const timestamp = toDate(message.timestamp);

  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
      if (hasError) {
        retry.retryNow();
      }
    } else if (e.key === 'Escape') {
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
      if (message.metadata?.transactionData?.txHash) {
        navigator.clipboard.writeText(message.metadata.transactionData.txHash);
      }
    }
  };

  return (
    <motion.div
      data-testid="message"
      initial={shouldAnimate ? "initial" : false}
      animate="animate"
      variants={variants}
      role="group"
      tabIndex={0}
      aria-label={`${isUser ? 'Your' : 'Assistant'} message`}
      aria-keyshortcuts={hasError ? 'R C Escape' : 'C Escape'}
      onKeyDown={handleMessageKeyDown}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
    >
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Avatar */}
        <div
          className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
        >
          <div
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-transform hover:scale-110 ${isUser
              ? 'bg-blue-600 text-white'
              : isDarkMode
                ? 'bg-gray-700 text-white'
                : 'bg-gray-600 text-white'
              }`}
          >
            {isUser ? (
              <User className="w-4 h-4" />
            ) : (
              <Bot className="w-4 h-4" />
            )}
          </div>

          <div className={`flex-1 ${isUser ? 'text-right' : 'text-left'}`}>
            {/* Message bubble */}
            <div
              className={`inline-block px-4 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 ${
                isUser
                  ? 'bg-blue-600 text-white'
                  : hasError
                    ? 'bg-red-50 border-red-200 text-red-900 shadow-red-100'
                    : isDarkMode
                      ? 'bg-gray-800 text-gray-100 border border-gray-700'
                      : 'bg-gray-100 text-gray-900 border border-gray-200'
              }`}
            >
              <div className="whitespace-pre-wrap break-words min-h-[20px] flex items-center">
                {isPending ? (
                  <div className="flex items-center space-x-2 text-gray-400">
                    <Loader2 className={`w-4 h-4 ${shouldReduceMotion ? '' : 'animate-spin'}`} />
                    <span className="text-sm italic">{t('common.loading')}</span>
                  </div>
                ) : isUser ? (
                  message.content
                ) : (
                  <ReactMarkdown
                    className="prose prose-sm max-w-none"
                    components={markdownComponents}
                  >
                    {maskedContent}
                  </ReactMarkdown>
                )}
              </div>
            </div>

            {/* Timestamp with read receipts */}
            <div
              className={`flex items-center mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} ${isUser ? 'justify-end' : 'justify-start'} group/timestamp`}
            >
              <span className="relative">
                <Clock className="w-3 h-3 mr-1" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-black text-white text-[10px] whitespace-nowrap opacity-0 group-hover/timestamp:opacity-100 transition-opacity pointer-events-none z-10">
                  {timestamp.toLocaleString([], {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </span>
              <span>{timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}</span>
              {isUser && message.metadata?.readAt && (
                <CheckCheck className="w-3.5 h-3.5 ml-1 text-blue-400" aria-label="Read" />
              )}
              {isUser && !message.metadata?.readAt && message.metadata?.deliveredAt && (
                <Check className="w-3.5 h-3.5 ml-1 text-blue-400" aria-label="Delivered" />
              )}
            </div>

            {/* Error State */}
            {hasError && (
              <div
                data-testid="message-error"
                role="alert"
                className={`mt-3 inline-flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs ${
                  isDarkMode
                    ? 'border-red-700 bg-red-950/40 text-red-200'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  <span>
                    {message.error?.message || 'Failed to send message'}
                  </span>
                </div>
                {totalRetryAttempts > 0 && (
                  <div className="text-xs opacity-75">
                    Retry attempts: {totalRetryAttempts}
                  </div>
                )}
                {onRetry && (
                  <>
                    <div
                      className="text-xs opacity-75"
                      aria-live="polite"
                      data-testid="message-retry-status"
                    >
                      {retry.isRetrying
                        ? t('chat.resending')
                        : retry.secondsUntilNextRetry !== null
                          ? t('chat.retry_countdown', {
                              seconds: retry.secondsUntilNextRetry,
                              attempt: retry.attempts + 1,
                              max: MAX_AUTO_RETRIES,
                            })
                          : t('chat.retry_exhausted', {
                              max: MAX_AUTO_RETRIES,
                            })}
                    </div>
                    <button
                      type="button"
                      onClick={retry.retryNow}
                      disabled={retry.isRetrying}
                      data-testid="message-retry-button"
                      aria-label={t('chat.retry_message', {
                        content: retryContent,
                      })}
                      title={retryContent}
                      className={`mt-2 flex items-center justify-center gap-2 px-3 py-1 rounded-lg text-xs font-medium transition-all transform hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                        isDarkMode
                          ? 'bg-red-700/40 hover:bg-red-700/60 border border-red-600'
                          : 'bg-red-100 hover:bg-red-200 border border-red-300'
                      }`}
                    >
                      <RotateCcw
                        className={`w-3 h-3 ${retry.isRetrying ? 'animate-spin' : ''}`}
                      />
                      {retry.isRetrying ? t('common.loading') : t('common.retry')}
                    </button>
                  </>
                )}
              </div>
            )}
            {message.metadata?.guardrail?.triggered && (
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${isDarkMode
                  ? 'border-amber-700 bg-amber-950/40 text-amber-200'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
              >
                <AlertTriangle className="h-4 w-4" />
                <span>
                  Guardrail:{' '}
                  {message.metadata.guardrail.category.replaceAll('_', ' ')}
                </span>
              </div>
            )}
            {isFailed && (
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  isDarkMode
                    ? 'border-red-700 bg-red-950/40 text-red-200'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                <XCircle className="h-4 w-4" />
                <span>{t('chat.error_message')}</span>
                <button 
                  onClick={() => window.location.reload()} 
                  className="ml-2 underline flex items-center gap-1"
                >
                  <RefreshCcw className="w-3 h-3" />
                  {t('common.retry')}
                </button>
              </div>
            )}
            {message.metadata?.requestStatus === 'cancelled' && (
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  isDarkMode
                    ? 'border-sky-700 bg-sky-950/40 text-sky-200'
                    : 'border-sky-200 bg-sky-50 text-sky-800'
                }`}
              >
                <AlertTriangle className="h-4 w-4" />
                <span>{t('chat.cancelled_message')}</span>
              </div>
            )}
            {message.metadata?.suggestedActions &&
              message.metadata.suggestedActions.length > 0 && (
                <div
                  className={`mt-4 flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {message.metadata.suggestedActions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() =>
                        onActionClick(action.id, action.type, action.data)
                      }
                      className={`flex items-center space-x-2 px-3 md:px-4 py-2 text-xs md:text-sm rounded-lg border transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 active:scale-95 ${action.priority
                        ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-lg shadow-blue-200 dark:shadow-blue-900/50'
                        : action.type === 'cancel'
                          ? 'bg-red-500 hover:bg-red-600 text-white border-red-500 shadow-lg shadow-red-200 dark:shadow-red-900/50'
                          : isDarkMode
                            ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-600'
                            : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
                        }`}
                    >
                      {action.type === 'confirm_fiat' && (
                        <Coins className="w-4 h-4" />
                      )}
                      {action.type === 'connect_wallet' && (
                        <Link className="w-4 h-4" />
                      )}
                      {action.type === 'cancel' && (
                        <AlertTriangle className="w-4 h-4" />
                      )}
                      <span>{action.label}</span>
                      {action.priority && (
                        <span className="text-xs opacity-75">⭐</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

            {/* Transaction Data Preview */}
            {message.metadata?.transactionData && (
              <div
                className={`theme-surface-muted theme-border mt-4 p-4 border rounded-xl text-sm ${isUser ? 'text-right' : 'text-left'}`}
              >
                <div className="theme-text-primary flex items-center space-x-2 font-medium mb-3">
                  <Coins className="w-4 h-4" />
                  <span>Transaction Details</span>
                </div>
                <div className="theme-text-secondary space-y-2">
                  {message.metadata.transactionData.type && (
                    <div className="flex justify-between">
                      <span>Type:</span>
                      <span className="theme-text-primary font-medium capitalize">
                        {message.metadata.transactionData.type}
                      </span>
                    </div>
                  )}
                  {message.metadata.transactionData.tokenIn && (
                    <div className="flex justify-between">
                      <span>Token:</span>
                      <span className="theme-text-primary font-medium">
                        {message.metadata.transactionData.tokenIn}
                      </span>
                    </div>
                  )}
                  {message.metadata.transactionData.amountIn && (
                    <div className="flex justify-between">
                      <span>Amount:</span>
                      <span className="theme-text-primary font-medium">
                        {conversionDisplayText || message.metadata.transactionData.amountIn}
                      </span>
                    </div>
                  )}
                  {message.metadata.transactionData.fiatAmount && (
                    <div className="flex justify-between">
                      <span>Fiat:</span>
                      <span className="theme-text-primary font-medium">
                        {message.metadata.transactionData.fiatAmount}{' '}
                        {message.metadata.transactionData.fiatCurrency || 'USD'}
                      </span>
                    </div>
                  )}
                  {message.metadata.transactionData.note && (
                    <div className="flex justify-between gap-3">
                      <span>Note:</span>
                      <span className="theme-text-primary font-medium">
                        {message.metadata.transactionData.note}
                      </span>
                    </div>
                  )}
                  {message.metadata.transactionData.transactionId && (
                    <div className="flex justify-between items-center gap-2">
                      <span>Request ID:</span>
                      <div className="flex items-center gap-1">
                        <span className="theme-text-primary font-mono text-xs">
                          {message.metadata.transactionData.transactionId.slice(0, 6)}
                          ...
                          {message.metadata.transactionData.transactionId.slice(-4)}
                        </span>
                        <CopyButton
                          value={message.metadata.transactionData.transactionId}
                          className="flex-shrink-0 p-0.5"
                          iconClassName="w-3 h-3"
                          ariaLabel="Copy transaction ID"
                        />
                      </div>
                    </div>
                  )}
                  {message.metadata.transactionData.txHash && (
                    <div className="flex justify-between items-center gap-2">
                      <span>Tx Hash:</span>
                      <div className="flex items-center gap-1">
                        <span className="theme-text-primary font-mono text-xs">
                          {message.metadata.transactionData.txHash.slice(0, 6)}
                          ...
                          {message.metadata.transactionData.txHash.slice(-4)}
                        </span>
                        <CopyButton
                          value={message.metadata.transactionData.txHash}
                          className="flex-shrink-0 p-0.5"
                          iconClassName="w-3 h-3"
                          ariaLabel="Copy transaction hash"
                        />
                      </div>
                    </div>
                  )}
                  {message.metadata.transactionData.receiptId && (
                    <div className="flex justify-between items-center gap-2">
                      <span>Receipt ID:</span>
                      <div className="flex items-center gap-1">
                        <span className="theme-text-primary font-mono text-xs">
                          {message.metadata.transactionData.receiptId.slice(0, 6)}
                          ...
                          {message.metadata.transactionData.receiptId.slice(-4)}
                        </span>
                        <CopyButton
                          value={message.metadata.transactionData.receiptId}
                          className="flex-shrink-0 p-0.5"
                          iconClassName="w-3 h-3"
                          ariaLabel="Copy receipt ID"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {message.metadata.confirmationRequired && (
                  <div className="theme-soft-warning mt-3 p-3 border rounded-lg text-xs">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4" />
                      <span>This transaction requires your confirmation</span>
                    </div>
                  </div>
                )}

                {message.metadata.lowConfidence &&
                  message.metadata.clarificationQuestion && (
                    <div className="theme-soft-warning mt-3 p-3 border rounded-lg text-xs">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span>{message.metadata.clarificationQuestion}</span>
                      </div>
                    </div>
                  )}

                {!connection.isConnected && (
                  <div className="theme-soft-danger mt-3 p-3 border rounded-lg text-xs">
                    <div className="flex items-center space-x-2">
                      <Link className="w-4 h-4" />
                      <span>Connect your wallet to proceed</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
