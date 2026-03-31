'use client';

import React, { useRef } from 'react';
import { ArrowLeftRight, X, ChevronDown } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { ChatSession, ChatMessage } from '@/types';
import { UseSplitViewReturn } from '@/hooks/useSplitView';

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
  isDarkMode: boolean;
}

function ThreadPane({
  session,
  label,
  selectedMessageId,
  allSessions,
  onSelectSession,
  onSelectMessage,
  isDarkMode,
}: ThreadPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className={`flex flex-col flex-1 min-w-0 border-r last:border-r-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}
      data-testid={`split-pane-${label.toLowerCase()}`}
    >
      {/* Pane header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-gray-50'}`}>
        <span className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {label}
        </span>

        {/* Thread selector */}
        <div className="relative flex-1">
          <select
            value={session?.id ?? ''}
            onChange={(e) => onSelectSession(e.target.value)}
            className={`w-full text-xs pl-2 pr-6 py-1 rounded border appearance-none outline-none focus:ring-1 focus:ring-blue-500 truncate ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-800'}`}
            aria-label={`Select ${label} thread`}
          >
            <option value="">— choose a thread —</option>
            {allSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || 'Untitled'}
              </option>
            ))}
          </select>
          <ChevronDown className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {!session ? (
          <div className={`flex items-center justify-center h-full text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Select a thread above
          </div>
        ) : session.messages.filter((m) => m.role !== 'system').length === 0 ? (
          <div className={`flex items-center justify-center h-full text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
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
                      ? isDarkMode
                        ? 'border-blue-500 bg-blue-900/30 ring-1 ring-blue-500'
                        : 'border-blue-400 bg-blue-50 ring-1 ring-blue-400'
                      : isDarkMode
                        ? 'border-gray-700 hover:border-gray-600 hover:bg-gray-800'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  aria-pressed={isSelected}
                  aria-label={`${isUser ? 'User' : 'Assistant'} message`}
                >
                  <span className={`font-semibold ${isUser ? (isDarkMode ? 'text-blue-400' : 'text-blue-600') : (isDarkMode ? 'text-green-400' : 'text-green-700')}`}>
                    {isUser ? 'You' : 'Assistant'}
                  </span>
                  <p className={`mt-1 line-clamp-3 leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {msg.content}
                  </p>
                  <p className={`mt-1 text-[10px] ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    {new Date(msg.timestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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
  const { isDarkMode } = useTheme();
  const { state, close, setLeftSession, setRightSession, swapSessions, selectMessage, leftSession, rightSession } = splitView;

  if (!state.isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Split-view thread comparison"
      data-testid="split-view-comparison"
    >
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
        <h2 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Compare Threads
        </h2>

        <div className="flex items-center gap-2">
          {state.selectedMessageId && (
            <span className={`text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-700'}`}>
              Message selected
            </span>
          )}

          {/* Swap button */}
          <button
            onClick={swapSessions}
            title="Swap threads"
            aria-label="Swap left and right threads"
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'}`}
            data-testid="swap-threads-btn"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Swap
          </button>

          {/* Close button */}
          <button
            onClick={close}
            title="Close comparison"
            aria-label="Close split-view"
            className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            data-testid="close-split-view-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Two panes */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ThreadPane
          session={leftSession}
          label="Left"
          selectedMessageId={state.selectedMessageId}
          allSessions={sessions}
          onSelectSession={setLeftSession}
          onSelectMessage={selectMessage}
          isDarkMode={isDarkMode}
        />
        <ThreadPane
          session={rightSession}
          label="Right"
          selectedMessageId={state.selectedMessageId}
          allSessions={sessions}
          onSelectSession={setRightSession}
          onSelectMessage={selectMessage}
          isDarkMode={isDarkMode}
        />
      </div>
    </div>
  );
}
