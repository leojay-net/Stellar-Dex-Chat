'use client';

import React, { useEffect, useState } from 'react';
import { Send, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/contexts/TranslationContext';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { saveDraft, getDraft, clearDraft } from '@/lib/draftUtils';
import { useIdempotentAction } from '@/hooks/useIdempotentAction';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onCancelRequest?: () => void;
  onNewChat?: () => void;
  onOpenHistory?: () => void;
  onOpenBridgeModal?: () => void;
  isLoading: boolean;
  placeholder?: string;
  sessionId?: string | null;
}

export default function ChatInput({
  onSendMessage,
  onCancelRequest,
  onNewChat,
  onOpenHistory,
  onOpenBridgeModal,
  isLoading,
  placeholder,
  sessionId,
}: ChatInputProps) {
  const { t } = useTranslation();
  const { connection } = useStellarWallet();
  const activePlaceholder = placeholder || t('chat.placeholder');
  const [message, setMessage] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  
  const { execute: executeSubmit, isProcessing: isSubmitting } = useIdempotentAction({
    cooldownMs: 1000,
    logSuppressed: true,
  });

  const commands = [
    { cmd: '/deposit', desc: t('common.deposit_desc') || 'Add funds to your Stellar account' },
    { cmd: '/rates', desc: t('common.rates_desc') || 'Check current market conversion rates' },
    { cmd: '/portfolio', desc: t('common.portfolio_desc') || 'View your asset balance and value' },
    { cmd: '/help', desc: t('common.help_desc') || 'Get assistance with platform features' },
  ];

  const handleInputChange = (val: string) => {
    setMessage(val);
    if (val === '/') {
      setShowCommands(true);
      setSelectedIndex(0);
    } else if (!val.startsWith('/') || val === '') {
      setShowCommands(false);
    }
  };

  const selectCommand = (cmd: string) => {
    setMessage(cmd + ' ');
    setShowCommands(false);
  };

  const [walletWarning, setWalletWarning] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connection.isConnected) {
      setWalletWarning(true);
      return;
    }
    setWalletWarning(false);
    if (message.trim() && !isLoading && !isSubmitting) {
      executeSubmit(async () => {
        onSendMessage(message.trim());
        setMessage('');
        if (sessionId) clearDraft(sessionId);
        setShowCommands(false);
      }, 'chat_message_submit');
    }
  };

  useEffect(() => {
    if (connection.isConnected) {
      setWalletWarning(false);
    }
  }, [connection.isConnected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev: number) => (prev + 1) % commands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          (prev: number) => (prev - 1 + commands.length) % commands.length,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectCommand(commands[selectedIndex].cmd);
      } else if (e.key === 'Escape') {
        setShowCommands(false);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const paletteCommands = [
    {
      id: 'new_chat',
      label: t('chat.new_chat'),
      keywords: 'new chat clear',
      run: () => onNewChat?.(),
    },
    {
      id: 'switch_thread',
      label: 'Switch Thread',
      keywords: 'switch thread history',
      run: () => onOpenHistory?.(),
    },
    {
      id: 'open_bridge_modal',
      label: 'Open Bridge Modal',
      keywords: 'bridge modal deposit',
      run: () => onOpenBridgeModal?.(),
    },
    {
      id: 'cancel_request',
      label: 'Cancel Pending Request',
      keywords: 'cancel stop abort request',
      run: () => onCancelRequest?.(),
    },
  ];

  const normalizedQuery = paletteQuery.trim().toLowerCase();
  const filteredPalette = paletteCommands.filter((cmd) => {
    if (!normalizedQuery) {
      return true;
    }
    return (
      cmd.label.toLowerCase().includes(normalizedQuery) ||
      cmd.keywords.includes(normalizedQuery)
    );
  });

  const executePaletteCommand = (idx: number) => {
    const selected = filteredPalette[idx];
    if (!selected) {
      return;
    }
    selected.run();
    setShowPalette(false);
    setPaletteQuery('');
    setPaletteIndex(0);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowPalette((prev: boolean) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load draft when session changes
  useEffect(() => {
    if (sessionId) {
      const draft = getDraft(sessionId);
      setMessage(draft || '');
    }
  }, [sessionId]);

  // Save draft when message changes
  useEffect(() => {
    if (sessionId && message.trim()) {
      saveDraft(sessionId, message);
    } else if (sessionId && !message.trim()) {
      clearDraft(sessionId);
    }
  }, [message, sessionId]);

  return (
    <form
      onSubmit={handleSubmit}
      className="theme-surface p-6 transition-colors duration-300 relative"
    >
      {showPalette && (
        <div className="absolute inset-x-6 bottom-full mb-3 rounded-xl border theme-surface shadow-2xl z-50">
          <div className="p-3 border-b">
            <input
              value={paletteQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setPaletteQuery(e.target.value);
                setPaletteIndex(0);
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setPaletteIndex((prev: number) =>
                    filteredPalette.length > 0
                      ? (prev + 1) % filteredPalette.length
                      : 0,
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPaletteIndex((prev: number) =>
                    filteredPalette.length > 0
                      ? (prev - 1 + filteredPalette.length) %
                        filteredPalette.length
                      : 0,
                  );
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  executePaletteCommand(paletteIndex);
                } else if (e.key === 'Escape') {
                  setShowPalette(false);
                }
              }}
              autoFocus
              placeholder="Type a command..."
              className="theme-input w-full rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredPalette.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => executePaletteCommand(i)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  i === paletteIndex ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <AnimatePresence>
        {showCommands && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-6 mb-2 w-64 theme-surface border rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="p-2 border-b bg-gray-50/50">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">
                {t('chat.commands')}
              </span>
            </div>
            {commands.map((c, i) => (
              <button
                key={c.cmd}
                type="button"
                onClick={() => selectCommand(c.cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex flex-col items-start px-4 py-3 transition-colors ${
                  i === selectedIndex
                    ? 'bg-blue-50 border-l-4 border-blue-500'
                    : 'hover:bg-gray-50 border-l-4 border-transparent'
                }`}
              >
                <span className="font-bold text-sm text-gray-900">{c.cmd}</span>
                <span className="text-xs text-gray-500">{c.desc}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end space-x-3">
        <div className="flex-1 relative">
          <textarea
            value={message}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activePlaceholder}
            disabled={isLoading}
            className="theme-input w-full resize-none border rounded-lg px-4 py-3 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            rows={1}
            style={{
              minHeight: '48px',
              maxHeight: '120px',
              height: 'auto',
            }}
            onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
        </div>

        <button
          type="submit"
          disabled={!message.trim() || isLoading || isSubmitting}
          className="theme-primary-button flex items-center justify-center w-12 h-12 disabled:bg-gray-300 text-white rounded-lg transition-all duration-200 disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100 shadow-lg"
        >
          {isLoading || isSubmitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      {walletWarning && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Wallet disconnected. Reconnect to continue.</span>
        </div>
      )}

      {/* Quick suggestions */}
      <div className="flex flex-wrap gap-2 mt-4">
        {[
          t('chat.suggestions.convert'),
          t('chat.suggestions.rates'),
          t('chat.suggestions.portfolio'),
        ].map((suggestion, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setMessage(suggestion)}
            className="theme-secondary-button px-3 py-2 text-sm rounded-lg transition-all duration-200 transform hover:scale-105"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </form>
  );
}
