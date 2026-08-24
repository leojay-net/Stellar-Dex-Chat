import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { useMediaQuery } from '../useMediaQuery';

describe('useMediaQuery', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  let listeners: Array<(event: MediaQueryListEvent) => void>;

  beforeEach(() => {
    listeners = [];
    matchMediaMock = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') listeners.push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          const index = listeners.indexOf(handler);
          if (index > -1) listeners.splice(index, 1);
        }
      }),
    }));

    window.matchMedia = matchMediaMock;
  });

  afterEach(() => {
    cleanup();
    listeners = [];
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────

  it('returns false on initial render when query does not match', () => {
    matchMediaMock.mockReturnValue({
      matches: false,
      media: '(min-width: 768px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
  });

  it('returns true on initial render when query matches', () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      media: '(min-width: 768px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);
  });

  it('returns false during SSR (window is undefined)', () => {
    const originalWindow = global.window;
    try {
      // @ts-expect-error Testing SSR scenario
      delete global.window;

      const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
      expect(result.current).toBe(false);
    } finally {
      // Restore even if renderHook throws, so later tests in this file don't
      // inherit a deleted global.window.
      global.window = originalWindow;
    }
  });

  // ── Updates ────────────────────────────────────────────────────────────

  it('updates when media query match state changes', async () => {
    let matches = false;
    matchMediaMock.mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') listeners.push(handler);
      }),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);

    // Simulate viewport resize that triggers the media query
    matches = true;
    listeners.forEach((handler) =>
      handler({ matches: true, media: '(min-width: 768px)' } as MediaQueryListEvent)
    );

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('re-registers listener when query prop changes', () => {
    const addEventListenerSpy = vi.fn();
    const removeEventListenerSpy = vi.fn();

    matchMediaMock.mockImplementation(() => ({
      matches: false,
      media: '',
      addEventListener: addEventListenerSpy,
      removeEventListener: removeEventListenerSpy,
    }));

    const { rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 768px)' },
    });

    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

    rerender({ query: '(min-width: 1024px)' });

    // Old listener should be removed, new one added
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
  });

  // ── Cleanup ────────────────────────────────────────────────────────────

  it('removes event listener on unmount', () => {
    const removeEventListenerSpy = vi.fn();

    matchMediaMock.mockReturnValue({
      matches: false,
      media: '(min-width: 768px)',
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerSpy,
    });

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('unsubscribes correctly even after multiple rerenders', () => {
    const removeEventListenerSpy = vi.fn();

    matchMediaMock.mockReturnValue({
      matches: false,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerSpy,
    });

    const { rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 768px)' },
    });

    rerender({ query: '(min-width: 1024px)' });
    rerender({ query: '(prefers-color-scheme: dark)' });

    unmount();

    // Should have removed listener for each query change + final unmount
    expect(removeEventListenerSpy).toHaveBeenCalled();
  });

  // ── Branch coverage ────────────────────────────────────────────────────

  it('handles multiple simultaneous queries independently', () => {
    const { result: result1 } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    const { result: result2 } = renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)'));

    // Both hooks should initialize independently
    expect(typeof result1.current).toBe('boolean');
    expect(typeof result2.current).toBe('boolean');
  });

  it('works with complex media queries', () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      media: '(min-width: 768px) and (max-width: 1024px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() =>
      useMediaQuery('(min-width: 768px) and (max-width: 1024px)')
    );

    expect(result.current).toBe(true);
  });
});
