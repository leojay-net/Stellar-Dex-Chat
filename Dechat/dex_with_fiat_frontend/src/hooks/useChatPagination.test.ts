import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ChatMessage } from '@/types';
import { useChatPagination } from './useChatPagination';

const createMessages = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: (i + 1).toString(),
    role: 'user' as const,
    content: `Message ${i + 1}`,
    timestamp: new Date(),
  }));

describe('useChatPagination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial load returns first page', () => {
    const messages = createMessages(50);
    const { result } = renderHook(() => useChatPagination(messages, 20));

    expect(result.current.visibleMessages).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.visibleMessages[0].id).toBe('31');
    expect(result.current.visibleMessages[19].id).toBe('50');
  });

  it('loadMore appends and advances cursor', () => {
    const messages = createMessages(50);
    const { result } = renderHook(() => useChatPagination(messages, 20));

    expect(result.current.visibleMessages).toHaveLength(20);

    act(() => {
      result.current.loadMore();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.visibleMessages).toHaveLength(40);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.visibleMessages[0].id).toBe('11');
    expect(result.current.visibleMessages[39].id).toBe('50');
  });

  it('hasMore is false when all messages fit in one page', () => {
    const messages = createMessages(10);
    const { result } = renderHook(() => useChatPagination(messages, 20));

    expect(result.current.visibleMessages).toHaveLength(10);
    expect(result.current.hasMore).toBe(false);
  });
});
