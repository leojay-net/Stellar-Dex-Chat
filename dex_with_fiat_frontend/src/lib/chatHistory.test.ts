import { describe, it, expect } from 'vitest';
import { ChatHistoryManager } from './chatHistory';
import { ChatSession } from '@/types';

describe('ChatHistoryManager', () => {
  describe('deduplicateSessions', () => {
    it('should remove duplicate sessions by ID', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);

      const sessions: ChatSession[] = [
        {
          id: 'session_1',
          title: 'Chat 1',
          messages: [],
          createdAt: earlier,
          lastUpdated: earlier,
        },
        {
          id: 'session_1',
          title: 'Chat 1 Updated',
          messages: [],
          createdAt: earlier,
          lastUpdated: now,
        },
        {
          id: 'session_2',
          title: 'Chat 2',
          messages: [],
          createdAt: now,
          lastUpdated: now,
        },
      ];

      const result = ChatHistoryManager.deduplicateSessions(sessions);

      expect(result).toHaveLength(2);
      expect(result.find((s) => s.id === 'session_1')?.title).toBe(
        'Chat 1 Updated',
      );
      expect(result.find((s) => s.id === 'session_2')).toBeDefined();
    });

    it('should keep the most recently updated session when duplicates exist', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 5000);
      const middle = new Date(now.getTime() - 2000);

      const sessions: ChatSession[] = [
        {
          id: 'session_1',
          title: 'Version 1',
          messages: [],
          createdAt: earlier,
          lastUpdated: earlier,
        },
        {
          id: 'session_1',
          title: 'Version 2',
          messages: [],
          createdAt: earlier,
          lastUpdated: middle,
        },
        {
          id: 'session_1',
          title: 'Version 3',
          messages: [],
          createdAt: earlier,
          lastUpdated: now,
        },
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
        {
          id: 'session_1',
          title: 'Chat 1',
          messages: [],
          createdAt: now,
          lastUpdated: now,
        },
        {
          id: 'session_2',
          title: 'Chat 2',
          messages: [],
          createdAt: now,
          lastUpdated: now,
        },
      ];

      const result = ChatHistoryManager.deduplicateSessions(sessions);

      expect(result).toHaveLength(2);
      expect(result).toEqual(sessions);
    });
  });
});
