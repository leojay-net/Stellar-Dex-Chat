'use client';

import { useMemo } from 'react';
import { ChatMessage } from '@/types';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Bot, User, AlertTriangle, Link, Clock, Coins } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { toDate } from '@/lib/messageUtils';

interface MessageProps {
  message: ChatMessage;
  onActionClick: (
    actionId: string,
    actionType: string,
    data?: Record<string, unknown>,
  ) => void;
}

export default function Message({ message, onActionClick }: MessageProps) {
  const { connection } = useStellarWallet();
  const { isDarkMode } = useTheme();
  const isUser = message.role === 'user';

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
    }),
    [isDarkMode],
  );

  // Safely parse the timestamp — guards against deserialized string values
  const timestamp = toDate(message.timestamp);

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-8 animate-fadeIn`}
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
              className={`inline-block px-4 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 ${isUser
                ? 'bg-blue-600 text-white'
                : isDarkMode
                  ? 'bg-gray-800 text-gray-100 border border-gray-700'
                  : 'bg-gray-100 text-gray-900 border border-gray-200'
                }`}
            >
              <div className="whitespace-pre-wrap break-words">
                {isUser ? (
                  message.content
                ) : (
                  <ReactMarkdown
                    className="prose prose-sm max-w-none"
                    components={markdownComponents}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <div
              className={`flex items-center mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <Clock className="w-3 h-3 mr-1" />
              {timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
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
                        {message.metadata.transactionData.amountIn}
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
    </div>
  );
}
