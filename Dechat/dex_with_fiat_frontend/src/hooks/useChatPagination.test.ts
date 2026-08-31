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

  it('uses DEFAULT_PAGE_SIZE when pageSize is omitted', () => {
    const messages = createMessages(60);
    const { result } = renderHook(() => useChatPagination(messages));

    expect(result.current.visibleMessages.length).toBeGreaterThan(0);
    expect(result.current.hasMore).toBe(true);
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

  it('ignores loadMore calls when hasMore is false', () => {
    const messages = createMessages(10);
    const { result } = renderHook(() => useChatPagination(messages, 20));

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.isLoadingMore).toBe(false);
  });

  it('ignores concurrent loadMore calls when isLoadingMore is already true', () => {
    const messages = createMessages(50);
    const { result } = renderHook(() => useChatPagination(messages, 20));

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.isLoadingMore).toBe(true);

    // Concurrent call should be a no-op
    act(() => {
      result.current.loadMore();
    });

    expect(result.current.isLoadingMore).toBe(true);
  });

  it('resets visibleCount when allMessages length drops below pageSize', () => {
    const initialMessages = createMessages(50);
    const { result, rerender } = renderHook(
      ({ messages }) => useChatPagination(messages, 20),
      { initialProps: { messages: initialMessages } }
    );

    act(() => {
      result.current.loadMore();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.visibleMessages).toHaveLength(40);

    // Switch session / drop message list to fewer than pageSize
    const newSessionMessages = createMessages(5);
    rerender({ messages: newSessionMessages });

    expect(result.current.visibleMessages).toHaveLength(5);
  });

  it('does not update state after unmount when setTimeout fires', () => {
    const messages = createMessages(50);
    const { result, unmount } = renderHook(() => useChatPagination(messages, 20));

    act(() => {
      result.current.loadMore();
    });

    // Unmount before the 400ms timer fires
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();
  });

  it('regression: uses the latest messages/pageSize when the pending timer fires, not the stale closure from when loadMore was called', () => {
    const initialMessages = createMessages(30);
    const { result, rerender } = renderHook(
      ({ messages, pageSize }) => useChatPagination(messages, pageSize),
      { initialProps: { messages: initialMessages, pageSize: 20 } },
    );

    expect(result.current.visibleMessages).toHaveLength(20);

    act(() => {
      result.current.loadMore();
    });

    const grownMessages = createMessages(45);
    rerender({ messages: grownMessages, pageSize: 20 });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.visibleMessages).toHaveLength(40);
    expect(result.current.visibleMessages[39].id).toBe('45');
  });

  it('isLoadingMore resets to false after loadMore completes', () => {
    const messages = createMessages(50);
    const { result } = renderHook(() => useChatPagination(messages, 20));

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.isLoadingMore).toBe(true);

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.isLoadingMore).toBe(false);
  });
});
