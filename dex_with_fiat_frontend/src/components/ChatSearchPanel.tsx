'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Calendar, Wallet, ChevronRight } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { ChatSession } from '@/types';
import {
  SearchFilters,
  MessageMatch,
  searchChatHistory,
  splitByHighlights,
  debounce,
} from '@/lib/chatSearch';

interface ChatSearchPanelProps {
  sessions: ChatSession[];
  onSelectResult: (sessionId: string, messageId: string) => void;
  onClose: () => void;
}

/** Renders a single message snippet with keyword highlights. */
function HighlightedSnippet({
  match,
  isDarkMode,
}: {
  match: MessageMatch;
  isDarkMode: boolean;
}) {
  const content = match.message.content;
  // Show a short excerpt centred around the first highlight
  const firstHl = match.highlights[0];
  let snippetStart = 0;
  let snippetEnd = Math.min(content.length, 120);
  if (firstHl) {
    snippetStart = Math.max(0, firstHl[0] - 30);
    snippetEnd = Math.min(content.length, firstHl[1] + 90);
  }
  const snippet = content.slice(snippetStart, snippetEnd);
  const prefix = snippetStart > 0 ? '…' : '';
  const suffix = snippetEnd < content.length ? '…' : '';

  // Re-map highlight positions relative to snippet
  const relativeHighlights = match.highlights
    .map(([s, e]): [number, number] => [s - snippetStart, e - snippetStart])
    .filter(([s, e]) => s >= 0 && e <= snippet.length);

  const segments = splitByHighlights(snippet, relativeHighlights);

  return (
    <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
      {prefix}
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark
            key={i}
            className={`rounded px-0.5 ${isDarkMode ? 'bg-yellow-500/30 text-yellow-200' : 'bg-yellow-200 text-yellow-900'}`}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
      {suffix}
    </p>
  );
}

export default function ChatSearchPanel({
  sessions,
  onSelectResult,
  onClose,
}: ChatSearchPanelProps) {
  const { isDarkMode } = useTheme();
  const [filters, setFilters] = useState<SearchFilters>({
    keyword: '',
    walletAddress: '',
    dateFrom: '',
    dateTo: '',
  });
  const [results, setResults] = useState<MessageMatch[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search — runs 300 ms after the last filter change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runSearch = useCallback(
    debounce((f: unknown) => {
      const { matches } = searchChatHistory(sessions, f as SearchFilters);
      setResults(matches);
    }, 300),
    [sessions],
  );

  useEffect(() => {
    runSearch(filters);
  }, [filters, runSearch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  const hasAnyFilter =
    filters.keyword || filters.walletAddress || filters.dateFrom || filters.dateTo;

  return (
    <div
      className={`flex flex-col h-full ${isDarkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'}`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <Search className={`w-4 h-4 flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search messages…"
          value={filters.keyword}
          onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
          className={`flex-1 bg-transparent text-sm outline-none placeholder:${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}
          aria-label="Search keyword"
        />
        {hasAnyFilter && (
          <button
            onClick={() =>
              setFilters({ keyword: '', walletAddress: '', dateFrom: '', dateTo: '' })
            }
            className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
            title="Clear filters"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onClose}
          className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          title="Close search"
          aria-label="Close search"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Advanced filters toggle */}
      <div className={`px-4 py-2 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-1 text-xs font-medium transition-colors ${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          />
          Advanced filters
        </button>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 gap-3">
            {/* Wallet address */}
            <label className="flex flex-col gap-1">
              <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <Wallet className="inline w-3 h-3 mr-1" />
                Wallet address
              </span>
              <input
                type="text"
                placeholder="e.g. GABCD…"
                value={filters.walletAddress}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, walletAddress: e.target.value }))
                }
                className={`text-xs px-2 py-1.5 rounded border outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                aria-label="Filter by wallet address"
              />
            </label>

            {/* Date range */}
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <Calendar className="inline w-3 h-3 mr-1" />
                  From
                </span>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, dateFrom: e.target.value }))
                  }
                  className={`text-xs px-2 py-1.5 rounded border outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                  aria-label="Date from"
                />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  To
                </span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, dateTo: e.target.value }))
                  }
                  className={`text-xs px-2 py-1.5 rounded border outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                  aria-label="Date to"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!hasAnyFilter ? (
          <div className={`flex flex-col items-center justify-center h-full gap-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <Search className="w-8 h-8 opacity-40" />
            <p className="text-sm">Type to search messages</p>
          </div>
        ) : results.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full gap-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <p className="text-sm">No messages found</p>
          </div>
        ) : (
          <ul className="divide-y" aria-label="Search results">
            {results.map((match) => (
              <li key={`${match.sessionId}-${match.message.id}`}>
                <button
                  onClick={() => onSelectResult(match.sessionId, match.message.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'}`}
                >
                  <p className={`text-xs font-semibold truncate ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    {match.sessionTitle}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {match.message.role === 'user' ? 'You' : 'Assistant'} ·{' '}
                    {new Date(match.message.timestamp).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                  <HighlightedSnippet match={match} isDarkMode={isDarkMode} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer count */}
      {hasAnyFilter && (
        <div className={`px-4 py-2 border-t text-xs ${isDarkMode ? 'border-gray-800 text-gray-500' : 'border-gray-100 text-gray-400'}`}>
          {results.length} result{results.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
