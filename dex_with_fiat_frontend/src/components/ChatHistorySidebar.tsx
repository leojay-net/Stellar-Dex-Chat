'use client';

import { useState, useEffect } from 'react';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useTxHistory } from '@/hooks/useTxHistory';
import {
  MessageSquare,
  Trash2,
  Search,
  X,
  Clock,
  Plus,
  Download,
  Coins,
  Pin,
  PinOff,
} from 'lucide-react';
import SkeletonSidebar from '@/components/ui/skeleton/SkeletonSidebar';
import EmptyState from '@/components/ui/EmptyState';
import PriceTicker from '@/components/PriceTicker';

import { ChatSession } from '@/types';

interface SessionRowProps {
  session: ChatSession;
  isActive: boolean;
  onLoad: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  formatDate: (d: Date) => string;
}

function SessionRow({
  session,
  isActive,
  onLoad,
  onExport,
  onDelete,
  onTogglePin,
  formatDate,
}: SessionRowProps) {
  return (
    <div
      className={`group relative p-3 mb-2 rounded-lg cursor-pointer transition-all duration-200 border ${
        isActive
          ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] shadow-md'
          : 'border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]'
      }`}
      onClick={() => onLoad(session.id)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="theme-text-primary text-sm font-medium truncate">
            {session.title || 'New Conversation'}
          </h3>
          <div className="theme-text-muted flex items-center mt-1 text-xs">
            <Clock className="w-3 h-3 mr-1" />
            <span>
              {formatDate(session.lastUpdated || session.createdAt || new Date())}
            </span>
            <span className="ml-2">{session.messages?.length || 0} messages</span>
          </div>
          {session.messages && session.messages.length > 0 && (
            <p className="theme-text-secondary text-xs mt-1 truncate">
              {session.messages[session.messages.length - 1]?.content?.substring(0, 50)}...
            </p>
          )}
        </div>

        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(session.id); }}
            className="theme-text-muted hover:bg-[var(--color-primary-soft)] p-1 rounded transition-all hover:scale-110"
            title={session.pinned ? 'Unpin conversation' : 'Pin conversation'}
          >
            {session.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onExport(session.id); }}
            className="theme-text-muted hover:bg-[var(--color-primary-soft)] p-1 rounded transition-all hover:scale-110"
            title="Export conversation"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
            className="theme-text-muted hover:bg-[var(--color-danger-soft)] p-1 rounded transition-all hover:scale-110"
            title="Delete conversation"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ChatHistorySidebarProps {
  onLoadSession: (sessionId: string) => void;
  onClose?: () => void;
  isCollapsed?: boolean;
}

export default function ChatHistorySidebar({
  onLoadSession,
  onClose,
  isCollapsed = false,
}: ChatHistorySidebarProps) {
  const {
    pinnedSessions,
    unpinnedSessions,
    currentSessionId,
    deleteSession,
    clearAllHistory,
    exportSession,
    searchSessions,
    togglePin,
    hasHistory,
  } = useChatHistory();
  const { entries, exportEntries, clearEntries, updateEntry } = useTxHistory();

  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const allSessions = [...pinnedSessions, ...unpinnedSessions];
  const filteredSessions = searchQuery ? searchSessions(searchQuery) : allSessions;
  const filteredPinned = filteredSessions.filter((s) => s.pinned);
  const filteredUnpinned = filteredSessions.filter((s) => !s.pinned);

  const handleDeleteSession = (sessionId: string) => {
    deleteSession(sessionId);
    setShowDeleteConfirm(null);
  };

  const handleExportSession = (sessionId: string) => {
    const exportData = exportSession(sessionId);
    if (!exportData) {
      return;
    }

    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-session-${sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportTransactions = () => {
    const blob = new Blob([exportEntries()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transaction-history.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div className={`theme-surface h-full flex flex-col transition-all duration-300 border-r ${isCollapsed ? 'w-20' : 'w-full'} transition-colors duration-300`}>
      <div className={`theme-border border-b transition-colors duration-300 ${isCollapsed ? 'p-4 flex flex-col items-center' : 'p-4'}`}>
        <div className={`flex items-center justify-between mb-4 w-full ${isCollapsed ? 'flex-col gap-4' : ''}`}>
          {!isCollapsed && <h2 className="theme-text-primary text-lg font-semibold">Activity</h2>}
          <div className={`flex items-center gap-1 ${isCollapsed ? 'flex-col' : ''}`}>
            <button
              onClick={clearAllHistory}
              className="theme-text-muted hover:bg-[var(--color-danger-soft)] p-2 rounded-lg transition-all duration-200 hover:scale-110"
              title="Clear all history"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="theme-text-muted hover:bg-[var(--color-surface-muted)] p-2 rounded-lg transition-all duration-200 hover:scale-110 sm:hidden"
                title="Close"
                aria-label="Close chat history"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div className="relative">
            <Search className="theme-text-muted absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="theme-input w-full pl-10 pr-4 py-2 rounded-lg text-sm border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="theme-text-muted hover:theme-text-primary absolute right-3 top-1/2 transform -translate-y-1/2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <SkeletonSidebar />
        ) : !hasHistory ? (
          <EmptyState
            icon={MessageSquare}
            title="No conversations yet"
            description="Start chatting to see your history here"
            cta={{ label: 'New Conversation', onClick: () => window.location.reload() }}
          />
        ) : filteredSessions.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No conversations found"
            description={`No results for "${searchQuery}"`}
            cta={{ label: 'Clear search', onClick: () => setSearchQuery('') }}
          />
        ) : (
          <div className={`p-2 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
            {filteredPinned.length > 0 && (
              <>
                {!isCollapsed && (
                  <p className="theme-text-muted text-xs font-semibold uppercase tracking-wider px-1 py-1 mt-1">
                    Pinned
                  </p>
                )}
                {filteredPinned.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    isActive={currentSessionId === session.id}
                    onLoad={onLoadSession}
                    onExport={handleExportSession}
                    onDelete={(id) => setShowDeleteConfirm(id)}
                    onTogglePin={togglePin}
                    formatDate={formatDate}
                  />
                ))}
                {!isCollapsed && filteredUnpinned.length > 0 && (
                  <p className="theme-text-muted text-xs font-semibold uppercase tracking-wider px-1 py-1 mt-3">
                    Recent
                  </p>
                )}
              </>
            )}
            {filteredUnpinned.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={currentSessionId === session.id}
                onLoad={onLoadSession}
                onExport={handleExportSession}
                onDelete={(id) => setShowDeleteConfirm(id)}
                onTogglePin={togglePin}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      <div className="theme-border border-t p-4 space-y-4">
        <PriceTicker symbols={['XLM', 'ETH', 'BTC']} currency="usd" />

        <div className="flex items-center justify-between mb-3">
      <div className={`theme-border border-t p-4 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
        <div className={`flex items-center justify-between mb-3 w-full ${isCollapsed ? 'flex-col gap-3' : ''}`}>
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-[var(--color-primary)]" />
            {!isCollapsed && (
              <h3 className="theme-text-primary text-sm font-semibold">
                Transaction History
              </h3>
            )}
          </div>
          {!isCollapsed && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleExportTransactions}
                className="theme-text-muted hover:bg-[var(--color-surface-muted)] p-1.5 rounded-md transition-colors"
                title="Export transaction history"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={clearEntries}
                className="theme-text-muted hover:bg-[var(--color-danger-soft)] p-1.5 rounded-md transition-colors"
                title="Clear transaction history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {isCollapsed ? (
          <div className="flex justify-center">
             <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
               {entries.length}
             </div>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Coins}
            title="No transactions yet"
            description="Deposits, payouts, risk checks, and notes will appear here."
            className="py-3"
          />
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {entries.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="theme-surface-muted theme-border rounded-lg border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="theme-text-primary text-xs font-semibold capitalize">
                      {entry.kind.replace('_', ' ')}
                    </p>
                    <p className="theme-text-secondary text-xs mt-1">
                      {entry.message}
                    </p>
                  </div>
                  <span className="theme-text-muted text-[11px] whitespace-nowrap">
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
                {(entry.amount || entry.fiatAmount) && (
                  <p className="theme-text-muted text-[11px] mt-2">
                    {entry.amount
                      ? `${entry.amount} ${entry.asset || 'XLM'}`
                      : ''}
                    {entry.amount && entry.fiatAmount ? ' · ' : ''}
                    {entry.fiatAmount
                      ? `${entry.fiatAmount} ${entry.fiatCurrency || 'NGN'}`
                      : ''}
                  </p>
                )}
                {entry.note && (
                  <p className="theme-text-primary text-xs mt-2">
                    Note:{' '}
                    <span className="theme-text-secondary">{entry.note}</span>
                  </p>
                )}
                {entry.kind === 'payout' &&
                  entry.status !== 'cancelled' &&
                  entry.reference &&
                  Date.now() - new Date(entry.createdAt).getTime() <
                    2 * 60 * 1000 && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch(
                            `/api/transfer-status/${entry.reference}`,
                            { method: 'POST' },
                          );
                          const json = await res.json();
                          if (json.success) {
                            updateEntry(entry.id, {
                              status: 'cancelled',
                              message: 'Payout cancelled.',
                            });
                          }
                        } catch (err) {
                          console.error('Cancel error:', err);
                        }
                      }}
                      className="mt-2 w-full flex items-center justify-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 py-1.5 rounded text-xs font-medium transition-colors"
                    >
                      <X className="w-3.5 h-3.5" /> Cancel Payout
                    </button>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="theme-border p-4 border-t transition-colors duration-300">
        <button
          onClick={() => window.location.reload()}
          className={`theme-primary-button w-full flex items-center justify-center rounded-lg transition-all duration-200 font-medium hover:scale-[1.02] ${isCollapsed ? 'p-2' : 'px-4 py-3'}`}
          title="New Conversation"
        >
          <Plus className={`w-4 h-4 ${isCollapsed ? '' : 'mr-2'}`} />
          {!isCollapsed && "New Conversation"}
        </button>
      </div>

      {showDeleteConfirm && (
        <div className="theme-overlay fixed inset-0 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="theme-surface theme-border rounded-lg p-6 max-w-sm mx-4 shadow-2xl border">
            <h3 className="theme-text-primary text-lg font-semibold mb-2">
              Delete Conversation
            </h3>
            <p className="theme-text-secondary mb-4">
              Are you sure you want to delete this conversation? This action
              cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="theme-secondary-button flex-1 px-4 py-2 rounded-lg transition-all duration-200 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => showDeleteConfirm && handleDeleteSession(showDeleteConfirm)}
                className="flex-1 px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all duration-200 font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
