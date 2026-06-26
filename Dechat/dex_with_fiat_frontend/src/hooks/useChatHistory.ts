'use client';

import { useState, useCallback, useEffect } from 'react';
import { ChatSession, ChatHistoryState, ChatMessage } from '@/types';
import { ChatHistoryManager } from '@/lib/chatHistory';
import { useStellarWallet } from '@/contexts/StellarWalletContext';

export const useChatHistory = () => {
  const { connection } = useStellarWallet();
  const [historyState, setHistoryState] = useState<ChatHistoryState>({
    currentSessionId: null,
    sessions: [],
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatSession[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    const loaded = ChatHistoryManager.loadFromLocalStorage();
    setHistoryState(loaded);
  }, []);

  // Debounced save to localStorage
  useEffect(() => {
    if (historyState.sessions.length > 0) {
      const timeoutId = setTimeout(() => {
        ChatHistoryManager.saveToLocalStorage(historyState);
      }, 500); // Debounce by 500ms

      return () => clearTimeout(timeoutId);
    }
  }, [historyState]);

  // Debounced search — avoids triggering a lookup on every keystroke
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(() => {
      setSearchResults(
        ChatHistoryManager.searchSessions(historyState.sessions, searchQuery),
      );
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, historyState.sessions]);

  const createNewSession = useCallback(
    (initialMessages: ChatMessage[] = []): string => {
      const newSession = ChatHistoryManager.createNewSession(
        connection.address,
      );
      newSession.messages = [...initialMessages]; // Clone to prevent reference issues

      setHistoryState((prev) => {
        // Deduplicate before adding new session
        const dedupedSessions = ChatHistoryManager.deduplicateSessions([
          newSession,
          ...prev.sessions,
        ]);

        const updatedSessions =
          ChatHistoryManager.cleanupOldSessions(dedupedSessions);

        return {
          currentSessionId: newSession.id,
          sessions: updatedSessions,
        };
      });

      return newSession.id;
    },
    [connection.address],
  );

  const updateCurrentSession = useCallback(
    (messages: ChatMessage[]) => {
      if (!historyState.currentSessionId) return;

      setHistoryState((prev) => {
        const sessionIndex = prev.sessions.findIndex(
          (s) => s.id === prev.currentSessionId,
        );
        if (sessionIndex === -1) return prev;

        const updatedSession = {
          ...prev.sessions[sessionIndex],
          messages,
          lastUpdated: new Date(),
        };

        // Update title if this is the first user message
        const updatedSessionWithTitle =
          ChatHistoryManager.updateSessionTitle(updatedSession);

        const updatedSessions = [...prev.sessions];
        updatedSessions[sessionIndex] = updatedSessionWithTitle;

        return {
          ...prev,
          sessions: updatedSessions,
        };
      });
    },
    [historyState.currentSessionId],
  );

  const loadSession = useCallback(
    (sessionId: string): ChatMessage[] | null => {
      const session = historyState.sessions.find((s) => s.id === sessionId);
      if (!session) return null;

      setHistoryState((prev) => ({
        ...prev,
        currentSessionId: sessionId,
      }));

      return session.messages;
    },
    [historyState.sessions],
  );

  const deleteSession = useCallback((sessionId: string) => {
    setHistoryState((prev) => {
      const updatedSessions = prev.sessions.filter((s) => s.id !== sessionId);
      const newCurrentSessionId =
        prev.currentSessionId === sessionId ? null : prev.currentSessionId;

      return {
        currentSessionId: newCurrentSessionId,
        sessions: updatedSessions,
      };
    });
  }, []);

  const clearAllHistory = useCallback(() => {
    setHistoryState({
      currentSessionId: null,
      sessions: [],
    });
    localStorage.removeItem('defi_chat_history');
  }, []);

  const exportSession = useCallback(
    (sessionId: string): string | null => {
      const session = historyState.sessions.find((s) => s.id === sessionId);
      if (!session) return null;

      return ChatHistoryManager.exportSession(session);
    },
    [historyState.sessions],
  );

  const exportSessionAsJSON = useCallback(
    (sessionId: string): { data: string; filename: string } | null => {
      const session = historyState.sessions.find((s) => s.id === sessionId);
      if (!session) return null;

      const data = ChatHistoryManager.exportSessionAsJSON(session);
      const filename = ChatHistoryManager.generateExportFilename(sessionId, 'json');
      return { data, filename };
    },
    [historyState.sessions],
  );

  const exportSessionAsTXT = useCallback(
    (sessionId: string): { data: string; filename: string } | null => {
      const session = historyState.sessions.find((s) => s.id === sessionId);
      if (!session) return null;

      const data = ChatHistoryManager.exportSessionAsTXT(session);
      const filename = ChatHistoryManager.generateExportFilename(sessionId, 'txt');
      return { data, filename };
    },
    [historyState.sessions],
  );

  const searchSessions = useCallback(
    (query: string): ChatSession[] => {
      return ChatHistoryManager.searchSessions(historyState.sessions, query);
    },
    [historyState.sessions],
  );

  const getCurrentSession = useCallback((): ChatSession | null => {
    if (!historyState.currentSessionId) return null;
    return (
      historyState.sessions.find(
        (s) => s.id === historyState.currentSessionId,
      ) || null
    );
  }, [historyState.currentSessionId, historyState.sessions]);

  const togglePin = useCallback((sessionId: string) => {
    setHistoryState((prev) => {
      const idx = prev.sessions.findIndex((s) => s.id === sessionId);
      if (idx === -1) return prev;

      const session = prev.sessions[idx];
      const nowPinned = !session.pinned;
      const updatedSession: ChatSession = {
        ...session,
        pinned: nowPinned,
        pinnedAt: nowPinned ? new Date() : undefined,
      };

      const updated = [...prev.sessions];
      updated[idx] = updatedSession;
      return { ...prev, sessions: updated };
    });
  }, []);

  const reorderPinned = useCallback((newPinnedOrder: string[]) => {
    setHistoryState((prev) => {
      const sessionsMap = new Map(prev.sessions.map((s) => [s.id, s]));
      const pinnedCount = newPinnedOrder.length;

      // Assign new pinnedAt timestamps to preserve ordering (newest first)
      const now = Date.now();
      const updated = [...prev.sessions];

      newPinnedOrder.forEach((id, index) => {
        const s = sessionsMap.get(id);
        if (!s) return;
        const updatedSession = { ...s, pinned: true, pinnedAt: new Date(now + (pinnedCount - index)) } as ChatSession;
        const idx = updated.findIndex((ss) => ss.id === id);
        if (idx !== -1) updated[idx] = updatedSession;
      });

      return { ...prev, sessions: updated };
    });
  }, []);

  // Pinned sessions first (sorted by pinnedAt desc), then unpinned (by lastUpdated desc)
  const sortedSessions = [...historyState.sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      return (b.pinnedAt?.getTime() ?? 0) - (a.pinnedAt?.getTime() ?? 0);
    }
    return (
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );
  });

  const pinnedSessions = sortedSessions.filter((s) => s.pinned);
  const unpinnedSessions = sortedSessions.filter((s) => !s.pinned);

  return {
    // State
    sessions: sortedSessions,
    pinnedSessions,
    unpinnedSessions,
    currentSessionId: historyState.currentSessionId,
    currentSession: getCurrentSession(),
    isHistoryOpen,

    // Actions
    createNewSession,
    updateCurrentSession,
    loadSession,
    deleteSession,
    clearAllHistory,
    reorderPinned,
    exportSession,
    exportSessionAsJSON,
    exportSessionAsTXT,
    searchSessions,
    togglePin,
    setIsHistoryOpen,

    // Utils
    hasHistory: historyState.sessions.length > 0,

    // Debounced search
    searchQuery,
    setSearchQuery,
    searchResults,
  };
};
