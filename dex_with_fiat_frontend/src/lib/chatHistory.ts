import { ChatMessage, ChatSession, ChatHistoryState } from '@/types';

// Types for localStorage serialization
interface SerializedSession {
  id: string;
  title: string;
  messages: SerializedMessage[];
  createdAt: string;
  lastUpdated: string;
  walletAddress?: string;
}

interface SerializedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const CHAT_HISTORY_KEY = 'defi_chat_history';
const MAX_SESSIONS = 50; // Limit to prevent storage overflow

export class ChatHistoryManager {
  static generateSessionTitle(messages: ChatMessage[]): string {
    // Find the first user message
    const firstUserMessage = messages.find((msg) => msg.role === 'user');
    if (firstUserMessage) {
      // Use first 30 characters of the first user message
      return firstUserMessage.content.length > 30
        ? firstUserMessage.content.substring(0, 30) + '...'
        : firstUserMessage.content;
    }

    // Fallback to timestamp-based title
    return `Chat ${new Date().toLocaleDateString()}`;
  }

  static saveToLocalStorage(state: ChatHistoryState): void {
    try {
      // Convert dates to strings for JSON serialization
      const serializable = {
        ...state,
        sessions: state.sessions.map((session) => ({
          ...session,
          createdAt: session.createdAt.toISOString(),
          lastUpdated: session.lastUpdated.toISOString(),
          messages: session.messages.map((msg) => ({
            ...msg,
            timestamp: msg.timestamp.toISOString(),
          })),
        })),
      };

      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(serializable));
    } catch (error) {
      console.error('Failed to save chat history:', error);
    }
  }

  static loadFromLocalStorage(): ChatHistoryState {
    try {
      const stored = localStorage.getItem(CHAT_HISTORY_KEY);
      if (!stored) {
        return { currentSessionId: null, sessions: [] };
      }

      const parsed = JSON.parse(stored);

      // Convert string dates back to Date objects
      const sessions = parsed.sessions.map((session: SerializedSession) => ({
        ...session,
        createdAt: new Date(session.createdAt),
        lastUpdated: new Date(session.lastUpdated),
        messages: session.messages.map((msg: SerializedMessage) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })),
      }));

      // Deduplicate sessions by ID (keep the most recent one)
      const deduped = this.deduplicateSessions(sessions);

      return {
        ...parsed,
        sessions: deduped,
      };
    } catch (error) {
      console.error('Failed to load chat history:', error);
      return { currentSessionId: null, sessions: [] };
    }
  }

  static deduplicateSessions(sessions: ChatSession[]): ChatSession[] {
    const sessionMap = new Map<string, ChatSession>();

    // Keep the most recently updated version of each session ID
    sessions.forEach((session) => {
      const existing = sessionMap.get(session.id);
      if (!existing || session.lastUpdated > existing.lastUpdated) {
        sessionMap.set(session.id, session);
      }
    });

    return Array.from(sessionMap.values());
  }

  static createNewSession(walletAddress?: string): ChatSession {
    const now = new Date();
    return {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: 'New Chat',
      messages: [],
      createdAt: now,
      lastUpdated: now,
      walletAddress,
    };
  }

  static updateSessionTitle(session: ChatSession): ChatSession {
    if (session.messages.length > 1) {
      // Has at least greeting + first user message
      return {
        ...session,
        title: this.generateSessionTitle(session.messages),
      };
    }
    return session;
  }

  static cleanupOldSessions(sessions: ChatSession[]): ChatSession[] {
    if (sessions.length <= MAX_SESSIONS) {
      return sessions;
    }

    // Sort by last updated (newest first) and keep only MAX_SESSIONS
    return sessions
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
      .slice(0, MAX_SESSIONS);
  }

  static exportSession(session: ChatSession): string {
    const exportData = {
      title: session.title,
      messages: session.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp.toISOString(),
        metadata: msg.metadata,
      })),
      createdAt: session.createdAt.toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  static searchSessions(sessions: ChatSession[], query: string): ChatSession[] {
    const lowercaseQuery = query.toLowerCase();

    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(lowercaseQuery) ||
        session.messages.some((msg) =>
          msg.content.toLowerCase().includes(lowercaseQuery),
        ),
    );
  }
}
