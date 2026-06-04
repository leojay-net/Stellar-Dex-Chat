'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/contexts/TranslationContext';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { saveDraft, getDraft, clearDraft } from '@/lib/draftUtils';
import { useIdempotentAction } from '@/hooks/useIdempotentAction';
import { useMediaQuery } from '@/hooks/useMediaQuery';

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
  // Detect the platform after mount rather than during render. Reading
  // `navigator` during render makes the server (no navigator → false) and an
  // Apple client (true) disagree, which produces a hydration mismatch on the
  // shortcut label/aria attributes. Defaulting to the SSR-safe value and
  // updating in an effect keeps the first client render identical to the
  // server markup. (#607)
  const [isApplePlatform, setIsApplePlatform] = useState(false);
  useEffect(() => {
    setIsApplePlatform(
      typeof navigator !== 'undefined' &&
        /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform),
    );
  }, []);
  const submitShortcutLabel = isApplePlatform ? 'Cmd+Enter' : 'Ctrl+Enter';
  const submitShortcutKeys = isApplePlatform ? 'Meta+Enter' : 'Control+Enter';
  const [message, setMessage] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 639px)');

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
  const isSubmitDisabled = !message.trim() || isLoading || isSubmitting;

  const submitMessage = () => {
    if (!connection.isConnected) {
      setWalletWarning(true);
      return;
    }
    setWalletWarning(false);
    if (!isSubmitDisabled) {
      executeSubmit(async () => {
        onSendMessage(message.trim());
        setMessage('');
        if (sessionId) clearDraft(sessionId);
        setShowCommands(false);
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 'chat_message_submit');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMessage();
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

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitMessage();
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault();
        onNewChat?.();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        onOpenHistory?.();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onOpenBridgeModal?.();
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        onCancelRequest?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNewChat, onOpenHistory, onOpenBridgeModal, onCancelRequest]);

  // Load draft when session changes
  useEffect(() => {
    if (sessionId) {
      const draft = getDraft(sessionId);
      setMessage(draft || '');
    } else {
      setMessage('');
    }
  }, [sessionId]);

  // Save draft when message changes (debounced 500ms)
  useEffect(() => {
    if (!sessionId) return;

    const timer = setTimeout(() => {
      if (message.trim()) {
        saveDraft(sessionId, message);
      } else {
        clearDraft(sessionId);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [message, sessionId]);

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="chat-input-form"
      data-mobile-layout={isMobile ? 'stacked' : 'inline'}
      className={`theme-surface transition-colors duration-300 relative border-t sm:border-none ${
        isMobile
          ? 'sticky bottom-0 z-20 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : 'p-4 sm:p-6'
      }`}
    >
      {showPalette && (
        <div
          className={`absolute bottom-full mb-3 rounded-xl border theme-surface shadow-2xl z-50 ${
            isMobile ? 'inset-x-3' : 'inset-x-6'
          }`}
        >
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
            className={`absolute bottom-full mb-2 theme-surface border rounded-xl shadow-2xl overflow-hidden z-50 ${
              isMobile ? 'left-3 right-3 w-auto' : 'left-6 w-64'
            }`}
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

      <div
        data-testid="chat-input-controls"
        className={isMobile ? 'flex flex-col gap-2' : 'flex items-end space-x-3'}
      >
        <div className="flex-1 relative min-w-0">
          <textarea
            data-testid="chat-input-textarea"
            value={message}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activePlaceholder}
            disabled={isLoading}
            aria-describedby="chat-submit-shortcut"
            aria-invalid={walletWarning}
            // Drive the border colour from an explicit theme-token class rather
            // than leaving it to the Tailwind utility cascade (which could
            // override `.theme-input`'s border-color and render an incorrect
            // colour), and surface the wallet-disconnected warning state. (#632)
            className={`theme-input w-full resize-none border rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
              isMobile ? 'px-3 py-2.5 text-base' : 'px-4 py-3'
            } ${
              walletWarning ? 'theme-input-border-invalid' : 'theme-input-border'
            }`}
            rows={1}
            style={{
              minHeight: isMobile ? '44px' : '48px',
              maxHeight: isMobile ? '100px' : '120px',
              height: 'auto',
            }}
            onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, isMobile ? 100 : 120)}px`;
            }}
          />
        </div>

        <button
          type="submit"
          data-testid="chat-input-send"
          disabled={isSubmitDisabled}
          title={`Send message (${submitShortcutLabel})`}
          aria-label={`Send message (${submitShortcutLabel})`}
          aria-describedby="chat-submit-shortcut"
          aria-keyshortcuts={submitShortcutKeys}
          className={`theme-primary-button flex items-center justify-center disabled:bg-gray-300 text-white rounded-lg transition-all duration-200 disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100 shadow-lg ${
            isMobile ? 'w-full h-11' : 'w-12 h-12'
          }`}
        >
          {isLoading || isSubmitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      <p id="chat-submit-shortcut" className="sr-only" aria-live="polite">
        Send message with {submitShortcutLabel}. The send button stays disabled while a request is pending.
      </p>

      {walletWarning && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Wallet disconnected. Reconnect to continue.</span>
        </div>
      )}

      {/* Quick suggestions */}
      <div ref={bottomRef} />
      <div className="flex flex-wrap gap-2 mt-3 sm:mt-4 overflow-x-auto pb-1 no-scrollbar">
        {[
          t('chat.suggestions.convert'),
          t('chat.suggestions.rates'),
          t('chat.suggestions.portfolio'),
        ].map((suggestion, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setMessage(suggestion)}
            className="theme-secondary-button px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-lg transition-all duration-200 transform hover:scale-105 whitespace-nowrap"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </form>
  );
}
