'use client';

import React, { useEffect, useRef } from 'react';
import { ArrowLeftRight, X, ChevronDown } from 'lucide-react';
import { ChatSession, ChatMessage } from '@/types';
import { UseSplitViewReturn } from '@/hooks/useSplitView';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';

interface SplitViewComparisonProps {
  splitView: UseSplitViewReturn;
  sessions: ChatSession[];
}

// ---------------------------------------------------------------------------
// Single pane — renders one thread's messages
// ---------------------------------------------------------------------------

interface ThreadPaneProps {
  session: ChatSession | null;
  label: string;
  selectedMessageId: string | null;
  allSessions: ChatSession[];
  onSelectSession: (id: string) => void;
  onSelectMessage: (id: string | null) => void;
}

function ThreadPane({
  session,
  label,
  selectedMessageId,
  allSessions,
  onSelectSession,
  onSelectMessage,
}: ThreadPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const paneId = `split-pane-${label.toLowerCase()}-region`;
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const scrollToMessage = (id: string) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${id}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const handleMessageClick = (msg: ChatMessage) => {
    const newId = selectedMessageId === msg.id ? null : msg.id;
    onSelectMessage(newId);
    if (newId) scrollToMessage(newId);
  };

  const formatTimestamp = (timestamp: number) => {
    if (!mounted) return ''; // Avoid hydration mismatch by not rendering on server
    return new Date(timestamp).toLocaleString([], {
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
      aria-label={`${label} thread comparison pane`}
      className="flex flex-col flex-1 min-w-0 border-r border-[var(--color-border)] last:border-r-0"
      data-testid={`split-pane-${label.toLowerCase()}`}
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
            aria-label={`Select ${label} thread`}
          >
            <option value="">— choose a thread —</option>
            {allSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || 'Untitled'}
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
        aria-label={`${label} thread messages`}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
      >
        {!session ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
            Select a thread above
          </div>
        ) : session.messages.filter((m) => m.role !== 'system').length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
            No messages in this thread
          </div>
        ) : (
          session.messages
            .filter((m) => m.role !== 'system')
            .map((msg) => {
              const isSelected = selectedMessageId === msg.id;
              const isUser = msg.role === 'user';
              return (
                <button
                  key={msg.id}
                  data-message-id={msg.id}
                  onClick={() => handleMessageClick(msg)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all border ${
                    isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
                  }`}
                  aria-pressed={isSelected}
                  aria-label={`${isUser ? 'User' : 'Assistant'} message`}
                >
                  <span
                    className={`font-semibold ${
                      isUser ? 'text-[var(--color-primary)]' : 'text-[var(--color-success)]'
                    }`}
                  >
                    {isUser ? 'You' : 'Assistant'}
                  </span>
                  <p className="mt-1 line-clamp-3 leading-relaxed text-[var(--color-text-secondary)]">
                    {msg.content}
                  </p>
                   <p className="mt-1 text-[10px] text-[var(--color-text-muted)]" data-testid="message-timestamp">
                     {formatTimestamp(msg.timestamp)}
                   </p>
                </button>
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
}: SplitViewComparisonProps) {
  const { state, close, setLeftSession, setRightSession, swapSessions, selectMessage, leftSession, rightSession } =
    splitView;

  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const { addToast } = useToast();
  // Fix (#523): initialise the ref to `true` (assume online at mount) so the
  // first offline transition is always detected correctly, regardless of the
  // order in which React commits the initial render vs. the effect.
  const wasOnlineRef = useRef(true);

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
        message:
          "You're offline. Thread comparison won't update until you reconnect.",
        severity: 'warning',
        durationMs: 4500,
      });
    } else if (!prevOnline && isOnline && wasOffline) {
      addToast({
        message: 'Back online. Comparison panes will use the latest thread data.',
        severity: 'success',
        durationMs: 3000,
      });
      resetWasOffline();
    }

    // Update ref AFTER the conditional logic to avoid stale-closure issues.
    wasOnlineRef.current = isOnline;
  }, [isOnline, wasOffline, addToast, resetWasOffline]);

  if (!state.isOpen) return null;

  const dialogTitleId = 'split-view-comparison-title';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--background)] text-[var(--foreground)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      data-testid="split-view-comparison"
    >
      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label="Comparison actions"
        className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] flex-shrink-0"
      >
        <h2 id={dialogTitleId} className="text-sm font-semibold text-[var(--color-text-primary)]">
          Compare Threads
        </h2>

        <div className="flex items-center gap-2">
          {state.selectedMessageId && (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
              Message selected
            </span>
          )}

          {/* Swap button */}
          <button
            onClick={swapSessions}
            title="Swap threads"
            aria-label="Swap left and right threads"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border)]"
            data-testid="swap-threads-btn"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden />
            Swap
          </button>

          {/* Close button */}
          <button
            onClick={close}
            title="Close comparison"
            aria-label="Close split-view"
            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
            data-testid="close-split-view-btn"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Two panes */}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
        <ThreadPane
          session={leftSession}
          label="Left"
          selectedMessageId={state.selectedMessageId}
          allSessions={sessions}
          onSelectSession={setLeftSession}
          onSelectMessage={selectMessage}
        />
        <ThreadPane
          session={rightSession}
          label="Right"
          selectedMessageId={state.selectedMessageId}
          allSessions={sessions}
          onSelectSession={setRightSession}
          onSelectMessage={selectMessage}
        />
      </div>
    </div>
  );
}
