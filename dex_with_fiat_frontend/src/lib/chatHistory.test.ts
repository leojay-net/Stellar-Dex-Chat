import { describe, it, expect } from 'vitest';
import { ChatHistoryManager } from '@/lib/chatHistory';
import { ChatSession, ChatMessage } from '@/types';

describe('ChatHistoryManager - Export Functionality', () => {
  const mockMessages: ChatMessage[] = [
    {
      id: 'msg1',
      role: 'user',
      content: 'How much will it cost to convert 100 XLM to NGN?',
      timestamp: new Date('2024-03-29T10:00:00Z'),
    },
    {
      id: 'msg2',
      role: 'assistant',
      content: 'Based on current rates, 100 XLM would be approximately 12,500 NGN.',
      timestamp: new Date('2024-03-29T10:01:00Z'),
      metadata: {
        transactionData: {
          type: 'fiat_conversion',
          tokenIn: 'XLM',
          amountIn: '100',
          fiatAmount: '12500',
          fiatCurrency: 'NGN',
        },
      },
    },
    {
      id: 'msg3',
      role: 'user',
      content: 'Please proceed with the conversion',
      timestamp: new Date('2024-03-29T10:02:00Z'),
    },
  ];

  const mockSession: ChatSession = {
    id: 'session_1711783200000_abcd1234',
    title: 'How much will it cost to convert 100 XLM to NGN?',
    messages: mockMessages,
    createdAt: new Date('2024-03-29T10:00:00Z'),
    lastUpdated: new Date('2024-03-29T10:02:00Z'),
    walletAddress: 'GAAA2C2YFYG3BQQKTG7GWMRNXFYCF5IOJLQD3BKLBW3C4DCZFQHC6EL',
  };

  describe('generateExportFilename', () => {
    it('should generate valid JSON filename', () => {
      const filename = ChatHistoryManager.generateExportFilename(mockSession.id, 'json');
      expect(filename).toMatch(/^chat_session_\d+_\d{4}-\d{2}-\d{2}_\d{6}\.json$/);
      expect(filename).toContain('.json');
    });

    it('should generate valid TXT filename', () => {
      const filename = ChatHistoryManager.generateExportFilename(mockSession.id, 'txt');
      expect(filename).toMatch(/^chat_session_\d+_\d{4}-\d{2}-\d{2}_\d{6}\.txt$/);
      expect(filename).toContain('.txt');
    });

    it('should sanitize session ID in filename', () => {
      const unsafeId = 'session@#$%^&*()_with_special_chars';
      const filename = ChatHistoryManager.generateExportFilename(unsafeId, 'json');
      expect(filename).not.toContain('@');
      expect(filename).not.toContain('#');
      expect(filename).not.toContain('$');
    });
  });

  describe('exportSessionAsJSON', () => {
    it('should export session with complete metadata', () => {
      const json = ChatHistoryManager.exportSessionAsJSON(mockSession);
      const data = JSON.parse(json);

      expect(data).toHaveProperty('metadata');
      expect(data.metadata.sessionId).toBe(mockSession.id);
      expect(data.metadata.title).toBe(mockSession.title);
      expect(data.metadata.totalMessages).toBe(mockMessages.length);
    });

    it('should include all message details', () => {
      const json = ChatHistoryManager.exportSessionAsJSON(mockSession);
      const data = JSON.parse(json);

      expect(data.messages).toHaveLength(mockMessages.length);
      expect(data.messages[0]).toEqual({
        id: mockMessages[0].id,
        role: mockMessages[0].role,
        content: mockMessages[0].content,
        timestamp: mockMessages[0].timestamp.toISOString(),
        metadata: null,
      });
    });

    it('should include transaction metadata', () => {
      const json = ChatHistoryManager.exportSessionAsJSON(mockSession);
      const data = JSON.parse(json);

      expect(data.messages[1].metadata).toBeDefined();
      expect(data.messages[1].metadata.transactionData.fiatAmount).toBe('12500');
      expect(data.messages[1].metadata.transactionData.fiatCurrency).toBe('NGN');
    });

    it('should be valid JSON', () => {
      const json = ChatHistoryManager.exportSessionAsJSON(mockSession);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('exportSessionAsTXT', () => {
    it('should export session as readable text', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toContain('CHAT SESSION EXPORT');
      expect(txt).toContain('SESSION METADATA');
      expect(txt).toContain('CONVERSATION');
      expect(txt).toContain(mockSession.title);
      expect(txt).toContain(mockSession.id);
    });

    it('should include all message content', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toContain('How much will it cost to convert 100 XLM to NGN?');
      expect(txt).toContain('Based on current rates, 100 XLM would be approximately 12,500 NGN.');
      expect(txt).toContain('Please proceed with the conversion');
    });

    it('should include role labels', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toContain('USER');
      expect(txt).toContain('ASSISTANT');
    });

    it('should include timestamps', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toMatch(/\d+\/\d+\/\d+/);
      expect(txt).toMatch(/\d+:\d+:\d+/);
    });

    it('should include transaction metadata', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toContain('Transaction Type: fiat_conversion');
      expect(txt).toContain('Fiat Amount: 12500 NGN');
      expect(txt).toContain('Amount In: 100 XLM');
    });

    it('should have decorative separators', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toContain('='.repeat(80));
      expect(txt).toContain('-'.repeat(80));
    });

    it('should include export timestamp', () => {
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(txt).toContain('Exported:');
    });
  });

  describe('exportSession (legacy)', () => {
    it('should use JSON format for backward compatibility', () => {
      const exported = ChatHistoryManager.exportSession(mockSession);
      const json = ChatHistoryManager.exportSessionAsJSON(mockSession);

      expect(exported).toBe(json);
    });
  });

  describe('Format comparison', () => {
    it('JSON format contains same data as TXT but structured', () => {
      const json = JSON.parse(ChatHistoryManager.exportSessionAsJSON(mockSession));
      const txt = ChatHistoryManager.exportSessionAsTXT(mockSession);

      expect(json.metadata.sessionId).toBe(mockSession.id);
      expect(txt).toContain(mockSession.id);

      expect(json.metadata.totalMessages).toBe(mockMessages.length);
      expect(txt).toContain(`Total Messages: ${mockMessages.length}`);

      expect(json.messages.length).toBe(mockMessages.length);
      mockMessages.forEach(msg => {
        expect(txt).toContain(msg.content);
      });
    });
  });
});

describe('ChatHistoryManager - Deduplication', () => {
  describe('deduplicateSessions', () => {
    it('should remove duplicate sessions by ID', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);

      const sessions: ChatSession[] = [
        { id: 'session_1', title: 'Chat 1', messages: [], createdAt: earlier, lastUpdated: earlier },
        { id: 'session_1', title: 'Chat 1 Updated', messages: [], createdAt: earlier, lastUpdated: now },
        { id: 'session_2', title: 'Chat 2', messages: [], createdAt: now, lastUpdated: now },
      ];

      const result = ChatHistoryManager.deduplicateSessions(sessions);

      expect(result).toHaveLength(2);
      expect(result.find((s) => s.id === 'session_1')?.title).toBe('Chat 1 Updated');
      expect(result.find((s) => s.id === 'session_2')).toBeDefined();
    });

    it('should keep the most recently updated session when duplicates exist', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 5000);
      const middle = new Date(now.getTime() - 2000);

      const sessions: ChatSession[] = [
        { id: 'session_1', title: 'Version 1', messages: [], createdAt: earlier, lastUpdated: earlier },
        { id: 'session_1', title: 'Version 2', messages: [], createdAt: earlier, lastUpdated: middle },
        { id: 'session_1', title: 'Version 3', messages: [], createdAt: earlier, lastUpdated: now },
      ];

      const result = ChatHistoryManager.deduplicateSessions(sessions);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Version 3');
      expect(result[0].lastUpdated).toEqual(now);
    });

    it('should handle empty array', () => {
      const result = ChatHistoryManager.deduplicateSessions([]);
      expect(result).toHaveLength(0);
    });

    it('should handle array with no duplicates', () => {
      const now = new Date();
      const sessions: ChatSession[] = [
        { id: 'session_1', title: 'Chat 1', messages: [], createdAt: now, lastUpdated: now },
        { id: 'session_2', title: 'Chat 2', messages: [], createdAt: now, lastUpdated: now },
      ];

      const result = ChatHistoryManager.deduplicateSessions(sessions);

      expect(result).toHaveLength(2);
      expect(result).toEqual(sessions);
    });
  });
});