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

  /**
   * Generate a filename for exported chat sessions
   * Format: chat_SESSION_ID_YYYY-MM-DD_HHmmss
   */
  static generateExportFilename(sessionId: string, format: 'json' | 'txt'): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHmmss
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
    return `chat_${safeSessionId}_${dateStr}_${timeStr}.${format}`;
  }

  /**
   * Export session as JSON with comprehensive metadata
   */
  static exportSessionAsJSON(session: ChatSession): string {
    const exportData = {
      metadata: {
        sessionId: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        lastUpdated: session.lastUpdated.toISOString(),
        walletAddress: session.walletAddress || null,
        totalMessages: session.messages.length,
        exportedAt: new Date().toISOString(),
      },
      messages: session.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp.toISOString(),
        metadata: msg.metadata || null,
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export session as formatted TXT with readable layout
   */
  static exportSessionAsTXT(session: ChatSession): string {
    const lines: string[] = [];

    // Header
    lines.push('='.repeat(80));
    lines.push(`CHAT SESSION EXPORT`);
    lines.push('='.repeat(80));
    lines.push('');

    // Metadata
    lines.push('SESSION METADATA');
    lines.push('-'.repeat(80));
    lines.push(`Title: ${session.title}`);
    lines.push(`Session ID: ${session.id}`);
    lines.push(`Created: ${session.createdAt.toLocaleString()}`);
    lines.push(`Last Updated: ${session.lastUpdated.toLocaleString()}`);
    if (session.walletAddress) {
      lines.push(`Wallet Address: ${session.walletAddress}`);
    }
    lines.push(`Total Messages: ${session.messages.length}`);
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push('');

    // Messages
    lines.push('CONVERSATION');
    lines.push('-'.repeat(80));
    lines.push('');

    session.messages.forEach((msg, index) => {
      const roleLabel = msg.role.toUpperCase();
      const timestamp = msg.timestamp.toLocaleString();
      lines.push(`[${index + 1}] ${roleLabel} (${timestamp})`);
      lines.push('-'.repeat(80));
      lines.push(msg.content);
      lines.push('');

      // Include metadata if present
      if (msg.metadata) {
        const hasRelevantMetadata = 
          msg.metadata.transactionData ||
          msg.metadata.suggestedActions ||
          msg.metadata.guardrail ||
          msg.metadata.clarificationQuestion;

        if (hasRelevantMetadata) {
          lines.push('Metadata:');
          if (msg.metadata.transactionData) {
            lines.push(`  Transaction Type: ${msg.metadata.transactionData.type}`);
            if (msg.metadata.transactionData.amountIn) {
              lines.push(`  Amount In: ${msg.metadata.transactionData.amountIn} ${msg.metadata.transactionData.tokenIn || 'XLM'}`);
            }
            if (msg.metadata.transactionData.fiatAmount) {
              lines.push(`  Fiat Amount: ${msg.metadata.transactionData.fiatAmount} ${msg.metadata.transactionData.fiatCurrency || 'USD'}`);
            }
          }
          if (msg.metadata.guardrail?.triggered) {
            lines.push(`  ⚠️ Guardrail: ${msg.metadata.guardrail.reason}`);
          }
          if (msg.metadata.clarificationQuestion) {
            lines.push(`  Question: ${msg.metadata.clarificationQuestion}`);
          }
          lines.push('');
        }
      }
    });

    // Footer
    lines.push('='.repeat(80));
    lines.push('End of conversation');
    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * Legacy export method for backward compatibility
   */
  static exportSession(session: ChatSession): string {
    return this.exportSessionAsJSON(session);
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
