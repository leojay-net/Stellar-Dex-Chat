'use client';

import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from 'react';
import {
  ArrowLeftRight,
  X,
  ChevronDown,
  Copy,
  Check,
  Columns2,
} from 'lucide-react';
import { ChatSession, ChatMessage } from '@/types';
import { UseSplitViewReturn } from '@/hooks/useSplitView';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';
import { useEffectiveDarkMode } from '@/hooks/useEffectiveDarkMode';
import { useTranslation } from '@/hooks/useTranslation';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/skeleton/Skeleton';

interface SplitViewComparisonProps {
  splitView: UseSplitViewReturn;
  sessions: ChatSession[];
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Single pane — renders one thread's messages
// ---------------------------------------------------------------------------

interface ThreadPaneProps {
  session: ChatSession | null;
  /**
   * Stable, non-translated identifier used for DOM ids and test ids.
   * The visible (translated) label is derived from it.
   */
  paneKey: 'left' | 'right';
  selectedMessageId: string | null;
  allSessions: ChatSession[];
  onSelectSession: (id: string) => void;
  onSelectMessage: (id: string | null) => void;
  onCopyMessage: (content: string) => Promise<void>;
}

function ThreadPane({
  session,
  paneKey,
  selectedMessageId,
  allSessions,
  onSelectSession,
  onSelectMessage,
  onCopyMessage,
}: ThreadPaneProps) {
  const { t, locale } = useTranslation();
  const label = t(paneKey === 'left' ? 'splitView.left' : 'splitView.right');
  const scrollRef = useRef<HTMLDivElement>(null);
  const paneId = `split-pane-${paneKey}-region`;
  const [mounted, setMounted] = React.useState(false);
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(
    null,
  );
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setMounted(true);
    return () => {
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const scrollToMessage = (id: string) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${id}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }
  };

  const handleMessageClick = (msg: ChatMessage) => {
    const newId = selectedMessageId === msg.id ? null : msg.id;
    onSelectMessage(newId);
    if (newId) scrollToMessage(newId);
  };

  const handleCopyMessage = async (
    e: React.MouseEvent,
    content: string,
    messageId: string,
  ) => {
    e.stopPropagation();
    // Optimistic UI update: immediately show checkmark
    setCopiedMessageId(messageId);
    // A previous copy's timeout must not clear feedback for a newer copy.
    if (copyResetTimerRef.current !== null) {
      clearTimeout(copyResetTimerRef.current);
    }
    await onCopyMessage(content);
    copyResetTimerRef.current = setTimeout(() => {
      setCopiedMessageId(null);
      copyResetTimerRef.current = null;
    }, 2000);
  };

  const formatTimestamp = (timestamp: number | Date) => {
    if (!mounted) return ''; // Avoid hydration mismatch by not rendering on server
    return new Date(timestamp).toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      id={paneId}
      role="region"
      aria-label={t('splitView.paneAria', { label })}
      className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden border-r border-[var(--color-border)] last:border-r-0"
      data-testid={`split-pane-${paneKey}`}
    >
      {/* Pane header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] flex-shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </span>

        {/* Thread selector */}
        <div className="relative flex-1">
          <select
            value={session?.id ?? ''}
            onChange={(e) => onSelectSession(e.target.value)}
            className="w-full text-xs pl-2 pr-6 py-1 rounded border border-[var(--color-border)] appearance-none outline-none focus:ring-2 focus:ring-[var(--color-primary)] truncate bg-[var(--color-surface)] text-[var(--color-text-primary)]"
            aria-label={t('splitView.selectThreadAria', { label })}
          >
            <option value="">{t('splitView.chooseThread')}</option>
            {allSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || t('splitView.untitled')}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-[var(--color-text-muted)]"
            aria-hidden
          />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-relevant="additions"
        aria-label={t('splitView.messagesAria', { label })}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
      >
        {!session ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
            {t('splitView.selectThreadAbove')}
          </div>
        ) : session.messages.filter((m) => m.role !== 'system').length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
            {t('splitView.noMessages')}
          </div>
        ) : (
          session.messages
            .filter((m) => m.role !== 'system')
            .map((msg) => {
              const isSelected = selectedMessageId === msg.id;
              const isUser = msg.role === 'user';
              const isCopied = copiedMessageId === msg.id;
              return (
                <div
                  key={msg.id}
                  data-message-id={msg.id}
                  className={`relative w-full text-left px-3 py-2 rounded-lg text-xs transition-all border group ${
                    isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
                  }`}
                >
                  <button
                    onClick={() => handleMessageClick(msg)}
                    className="w-full text-left"
                    aria-pressed={isSelected}
                    aria-label={t(
                      isUser
                        ? 'splitView.userMessageAria'
                        : 'splitView.assistantMessageAria',
                    )}
                  >
                    <span
                      className={`font-semibold ${
                        isUser
                          ? 'text-[var(--color-primary)]'
                          : 'text-[var(--color-success)]'
                      }`}
                    >
                      {isUser ? t('splitView.you') : t('splitView.assistant')}
                    </span>
                    <p className="mt-1 line-clamp-3 leading-relaxed text-[var(--color-text-secondary)]">
                      {msg.content}
                    </p>
                    <p
                      className="mt-1 text-[10px] text-[var(--color-text-muted)]"
                      data-testid="message-timestamp"
                    >
                      {formatTimestamp(msg.timestamp)}
                    </p>
                  </button>

                  {/* Copy button */}
                  <button
                    onClick={(e) => void handleCopyMessage(e, msg.content, msg.id)}
                    className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
                    aria-label={t('splitView.copyAria')}
                    title={t('splitView.copyTitle')}
                    data-testid="copy-message-btn"
                  >
                    {isCopied ? (
                      <Check
                        className="w-3 h-3 text-[var(--color-success)]"
                        aria-hidden
                      />
                    ) : (
                      <Copy
                        className="w-3 h-3 text-[var(--color-text-muted)]"
                        aria-hidden
                      />
                    )}
                  </button>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main split-view panel
// ---------------------------------------------------------------------------

export default function SplitViewComparison({
  splitView,
  sessions,
  isLoading = false,
}: SplitViewComparisonProps) {
  const {
    state,
    close,
    setLeftSession,
    setRightSession,
    swapSessions,
    selectMessage,
  } = splitView;

  const { t } = useTranslation();
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const { addToast } = useToast();
  const isDarkMode = useEffectiveDarkMode();
  const effectiveTheme = isDarkMode ? 'dark' : 'light';
  const themeFallback = isDarkMode
    ? 'bg-slate-950 text-slate-50'
    : 'bg-slate-50 text-slate-900';
  // Fix (#523): initialise the ref to `true` (assume online at mount) so the
  // first offline transition is always detected correctly, regardless of the
  // order in which React commits the initial render vs. the effect.
  const wasOnlineRef = useRef(true);

  // ── Optimistic UI state ──────────────────────────────────────────────────
  const [optimisticLeftId, setOptimisticLeftId] = useState<string | null>(
    state.leftSessionId,
  );
  const [optimisticRightId, setOptimisticRightId] = useState<string | null>(
    state.rightSessionId,
  );
  const [optimisticSelectedId, setOptimisticSelectedId] = useState<
    string | null
  >(state.selectedMessageId);

  useEffect(() => {
    setOptimisticLeftId(state.leftSessionId);
    setOptimisticRightId(state.rightSessionId);
    setOptimisticSelectedId(state.selectedMessageId);
  }, [state.leftSessionId, state.rightSessionId, state.selectedMessageId]);

  const effectiveLeftSession = useMemo(() => {
    const id = optimisticLeftId ?? state.leftSessionId;
    if (!id) return null;
    return sessions.find((s) => s.id === id) ?? null;
  }, [optimisticLeftId, state.leftSessionId, sessions]);

  const effectiveRightSession = useMemo(() => {
    const id = optimisticRightId ?? state.rightSessionId;
    if (!id) return null;
    return sessions.find((s) => s.id === id) ?? null;
  }, [optimisticRightId, state.rightSessionId, sessions]);

  const effectiveSelectedMessageId =
    optimisticSelectedId !== undefined
      ? optimisticSelectedId
      : state.selectedMessageId;

  const handleSwapSessions = useCallback(() => {
    const currentLeft = optimisticLeftId ?? state.leftSessionId;
    const currentRight = optimisticRightId ?? state.rightSessionId;
    setOptimisticLeftId(currentRight);
    setOptimisticRightId(currentLeft);
    setOptimisticSelectedId(null);
    swapSessions();
  }, [
    optimisticLeftId,
    optimisticRightId,
    state.leftSessionId,
    state.rightSessionId,
    swapSessions,
  ]);

  const handleSelectLeftSession = useCallback(
    (id: string) => {
      setOptimisticLeftId(id || null);
      setOptimisticSelectedId(null);
      setLeftSession(id);
    },
    [setLeftSession],
  );

  const handleSelectRightSession = useCallback(
    (id: string) => {
      setOptimisticRightId(id || null);
      setOptimisticSelectedId(null);
      setRightSession(id);
    },
    [setRightSession],
  );

  const handleSelectMessage = useCallback(
    (id: string | null) => {
      setOptimisticSelectedId(id);
      selectMessage(id);
    },
    [selectMessage],
  );

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      addToast({
        message: t('splitView.copied'),
        severity: 'success',
        durationMs: 2000,
      });
    } catch {
      addToast({
        message: t('splitView.copyFailed'),
        severity: 'error',
        durationMs: 3000,
      });
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Capture the previous value before updating the ref so the comparison
    // is always against the state from the *previous* render cycle.
    // Updating the ref at the end of the effect (not the start) eliminates
    // the race where a rapid online→offline→online sequence could read a
    // stale ref value and skip one of the toasts.
    const prevOnline = wasOnlineRef.current;

    if (prevOnline && !isOnline) {
      addToast({
        message: t('splitView.offline'),
        severity: 'warning',
        durationMs: 4500,
      });
    } else if (!prevOnline && isOnline && wasOffline) {
      addToast({
        message: t('splitView.backOnline'),
        severity: 'success',
        durationMs: 3000,
      });
      resetWasOffline();
    }

    // Update ref AFTER the conditional logic to avoid stale-closure issues.
    wasOnlineRef.current = isOnline;
  }, [isOnline, wasOffline, addToast, resetWasOffline, t]);

  if (!state.isOpen) return null;

  const bothEmpty = !effectiveLeftSession && !effectiveRightSession;

  const dialogTitleId = 'split-view-comparison-title';

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-[var(--background)] text-[var(--foreground)] ${themeFallback}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      aria-busy={isLoading}
      data-testid="split-view-comparison"
      data-effective-theme={effectiveTheme}
    >
      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label={t('splitView.toolbarAria')}
        className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] flex-shrink-0"
      >
        <h2
          id={dialogTitleId}
          className="text-sm font-semibold text-[var(--color-text-primary)]"
        >
          {t('splitView.title')}
        </h2>

        <div className="flex items-center gap-2">
          {effectiveSelectedMessageId && (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
              {t('splitView.messageSelected')}
            </span>
          )}

          {/* Swap button */}
          <button
            onClick={handleSwapSessions}
            title={t('splitView.swapTitle')}
            aria-label={t('splitView.swapAria')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border)]"
            data-testid="swap-threads-btn"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden />
            {t('splitView.swap')}
          </button>

          {/* Close button */}
          <button
            onClick={close}
            title={t('splitView.closeTitle')}
            aria-label={t('splitView.closeAria')}
            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
            data-testid="close-split-view-btn"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Two panes */}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
        {isLoading ? (
          <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row gap-4 p-4">
            {[1, 2].map((index) => (
              <div
                key={index}
                className="flex-1 space-y-4"
                data-testid="split-view-skeleton"
              >
                <Skeleton className="h-10 w-3/4 bg-slate-200 dark:bg-slate-700" />
                <div className="space-y-3">
                  <Skeleton className="h-16 bg-slate-200 dark:bg-slate-700" />
                  <Skeleton className="h-16 bg-slate-200 dark:bg-slate-700" />
                  <Skeleton className="h-16 bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        ) : bothEmpty ? (
          <EmptyState
            icon={Columns2}
            title={t('splitView.emptyTitle')}
            description={t('splitView.emptyDescription')}
          />
        ) : (
          <>
            <ThreadPane
              session={effectiveLeftSession}
              paneKey="left"
              selectedMessageId={effectiveSelectedMessageId}
              allSessions={sessions}
              onSelectSession={handleSelectLeftSession}
              onSelectMessage={handleSelectMessage}
              onCopyMessage={handleCopyMessage}
            />
            <ThreadPane
              session={effectiveRightSession}
              paneKey="right"
              selectedMessageId={effectiveSelectedMessageId}
              allSessions={sessions}
              onSelectSession={handleSelectRightSession}
              onSelectMessage={handleSelectMessage}
              onCopyMessage={handleCopyMessage}
            />
          </>
        )}
      </div>
    </div>
  );
}
