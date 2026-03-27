import { describe, it, expect } from 'vitest';
import {
  getDisplayedMessages,
  hasMoreMessages,
  DEFAULT_PAGE_SIZE,
} from './chatPaginationUtils';
import { ChatMessage } from '@/types';

// Helper to create a minimal ChatMessage array of `count` items
function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    role: 'user' as const,
    content: `Message ${i}`,
    timestamp: new Date(i * 1000),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// getDisplayedMessages
// ─────────────────────────────────────────────────────────────────────────────
describe('getDisplayedMessages', () => {
  it('returns all messages when count <= PAGE_SIZE (page 1)', () => {
    const messages = makeMessages(10);
    const result = getDisplayedMessages(messages, 1, 20);
    expect(result).toHaveLength(10);
    expect(result).toEqual(messages);
  });

  it('returns last PAGE_SIZE messages on page 1 when count > PAGE_SIZE', () => {
    const messages = makeMessages(50);
    const result = getDisplayedMessages(messages, 1, 20);
    expect(result).toHaveLength(20);
    // Should be the last 20 (indices 30-49)
    expect(result[0].id).toBe('30');
    expect(result[result.length - 1].id).toBe('49');
  });

  it('returns last 2*PAGE_SIZE messages on page 2', () => {
    const messages = makeMessages(60);
    const result = getDisplayedMessages(messages, 2, 20);
    expect(result).toHaveLength(40);
    expect(result[0].id).toBe('20');
    expect(result[result.length - 1].id).toBe('59');
  });

  it('does not go below index 0 when page * size > total', () => {
    const messages = makeMessages(15);
    const result = getDisplayedMessages(messages, 3, 20);
    expect(result).toHaveLength(15); // clipped at 0
    expect(result[0].id).toBe('0');
  });

  it('returns empty array for empty messages', () => {
    expect(getDisplayedMessages([], 1, 20)).toHaveLength(0);
  });

  it('uses DEFAULT_PAGE_SIZE when pageSize is omitted', () => {
    const messages = makeMessages(DEFAULT_PAGE_SIZE + 5);
    const result = getDisplayedMessages(messages, 1);
    expect(result).toHaveLength(DEFAULT_PAGE_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasMoreMessages
// ─────────────────────────────────────────────────────────────────────────────
describe('hasMoreMessages', () => {
  it('returns false when total <= PAGE_SIZE on page 1', () => {
    expect(hasMoreMessages(20, 1, 20)).toBe(false);
    expect(hasMoreMessages(10, 1, 20)).toBe(false);
  });

  it('returns true when total > PAGE_SIZE on page 1', () => {
    expect(hasMoreMessages(21, 1, 20)).toBe(true);
    expect(hasMoreMessages(100, 1, 20)).toBe(true);
  });

  it('returns false when all messages fit on current page', () => {
    expect(hasMoreMessages(35, 2, 20)).toBe(false); // 35 <= 2*20=40
  });

  it('returns true when there are still older messages on page 2', () => {
    expect(hasMoreMessages(50, 2, 20)).toBe(true); // 50 > 2*20=40
  });

  it('returns false for 0 messages', () => {
    expect(hasMoreMessages(0, 1, 20)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loading guard – simulated via isLoadingMore flag logic
// ─────────────────────────────────────────────────────────────────────────────
describe('loading guard logic', () => {
  it('prevents loadMore when isLoadingMore is true', () => {
    let page = 1;
    let isLoadingMore = true;

    // Simulating what loadMore does: should bail early if isLoadingMore
    const callCount = { value: 0 };
    function loadMore() {
      if (isLoadingMore) return; // guard
      callCount.value++;
      page++;
    }

    loadMore();
    expect(callCount.value).toBe(0);
    expect(page).toBe(1);
  });

  it('prevents loadMore when hasMore is false', () => {
    let page = 1;
    const total = 10;
    const pageSize = 20;
    const isLoadingMore = false;

    const callCount = { value: 0 };
    function loadMore() {
      if (isLoadingMore || !hasMoreMessages(total, page, pageSize)) return;
      callCount.value++;
      page++;
    }

    loadMore();
    expect(callCount.value).toBe(0);
    expect(page).toBe(1);
  });

  it('allows loadMore when not loading and hasMore is true', () => {
    let page = 1;
    const total = 50;
    const pageSize = 20;
    let isLoadingMore = false;

    function loadMore() {
      if (isLoadingMore || !hasMoreMessages(total, page, pageSize)) return;
      isLoadingMore = true;
      page++;
      isLoadingMore = false;
    }

    loadMore();
    expect(page).toBe(2);
  });

  it('resets page when session changes', () => {
    let page = 3;
    let sessionId = 'session_A';

    // Simulate the useEffect that resets page on session change
    function onSessionChange(newId: string) {
      if (newId !== sessionId) {
        page = 1;
        sessionId = newId;
      }
    }

    onSessionChange('session_B');
    expect(page).toBe(1);
    expect(sessionId).toBe('session_B');
  });
});
