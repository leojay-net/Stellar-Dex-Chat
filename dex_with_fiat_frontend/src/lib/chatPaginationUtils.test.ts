import { describe, it, expect } from 'vitest';
import { ChatMessage } from '@/types';
import {
  getVisibleMessages,
  hasMoreMessages,
  getNextMessageCount,
} from './chatPaginationUtils';

describe('chatPaginationUtils', () => {
  const mockMessages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
    id: (i + 1).toString(),
    role: 'user',
    content: `Message ${i + 1}`,
    timestamp: new Date(),
  }));

  describe('getVisibleMessages', () => {
    it('returns empty array for empty input', () => {
      expect(getVisibleMessages([], 20)).toEqual([]);
    });

    it('returns all messages if count exceeds length', () => {
      const messages = mockMessages.slice(0, 10);
      expect(getVisibleMessages(messages, 20)).toHaveLength(10);
      expect(getVisibleMessages(messages, 20)).toEqual(messages);
    });

    it('returns the last N messages', () => {
      const result = getVisibleMessages(mockMessages, 20);
      expect(result).toHaveLength(20);
      expect(result[0].id).toBe('31');
      expect(result[19].id).toBe('50');
    });
  });

  describe('hasMoreMessages', () => {
    it('returns true if more messages exist', () => {
      expect(hasMoreMessages(mockMessages, 20)).toBe(true);
      expect(hasMoreMessages(mockMessages, 49)).toBe(true);
    });

    it('returns false if all messages are visible', () => {
      expect(hasMoreMessages(mockMessages, 50)).toBe(false);
      expect(hasMoreMessages(mockMessages, 60)).toBe(false);
    });

    it('returns false for empty list', () => {
      expect(hasMoreMessages([], 0)).toBe(false);
    });
  });

  describe('getNextMessageCount', () => {
    it('increments correctly by page size', () => {
      expect(getNextMessageCount(mockMessages, 20, 10)).toBe(30);
    });

    it('caps at total length', () => {
      expect(getNextMessageCount(mockMessages, 45, 10)).toBe(50);
    });

    it('handles custom page size', () => {
      expect(getNextMessageCount(mockMessages, 20, 5)).toBe(25);
    });
  });
});
