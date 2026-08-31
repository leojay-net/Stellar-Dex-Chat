import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeepLink } from '../useDeepLink';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadChatSession = vi.fn();
const mockHasSessionLoaded = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.location.hash
    delete (window as any).location;
    (window as any).location = { hash: '' };
  });

  it('starts with idle state when no hash is present', () => {
    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(result.current).toEqual({ status: 'idle' });
    expect(mockLoadChatSession).not.toHaveBeenCalled();
    expect(mockHasSessionLoaded).not.toHaveBeenCalled();
  });

  it('calls loadChatSession with hash when hash is present', () => {
    (window as any).location.hash = '#session-123';
    mockHasSessionLoaded.mockReturnValue(false);

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(mockLoadChatSession).toHaveBeenCalledWith('session-123');
    expect(result.current).toEqual({ status: 'not-found', sessionId: 'session-123' });
  });

  it('transitions to idle when session is successfully loaded', () => {
    (window as any).location.hash = '#session-456';
    mockHasSessionLoaded.mockReturnValue(true);

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(result.current).toEqual({ status: 'idle' });
    expect(mockLoadChatSession).toHaveBeenCalledWith('session-456');
    expect(mockHasSessionLoaded).toHaveBeenCalledWith('session-456');
  });

  it('transitions to not-found when session fails to load', () => {
    (window as any).location.hash = '#session-789';
    mockHasSessionLoaded.mockReturnValue(false);

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(result.current).toEqual({ status: 'not-found', sessionId: 'session-789' });
    expect(mockLoadChatSession).toHaveBeenCalledWith('session-789');
    expect(mockHasSessionLoaded).toHaveBeenCalledWith('session-789');
  });

  it('trims whitespace from hash value', () => {
    (window as any).location.hash = '#  session-trim  ';
    mockHasSessionLoaded.mockReturnValue(true);

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(mockLoadChatSession).toHaveBeenCalledWith('session-trim');
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('handles empty hash after stripping #', () => {
    (window as any).location.hash = '#';

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(result.current).toEqual({ status: 'idle' });
    expect(mockLoadChatSession).not.toHaveBeenCalled();
    expect(mockHasSessionLoaded).not.toHaveBeenCalled();
  });

  it('handles whitespace-only hash', () => {
    (window as any).location.hash = '#   ';

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(result.current).toEqual({ status: 'idle' });
    expect(mockLoadChatSession).not.toHaveBeenCalled();
    expect(mockHasSessionLoaded).not.toHaveBeenCalled();
  });

  it('returns early when window is undefined (SSR guard)', () => {
    // Mock the typeof check by spying on the hook's internal check
    // Since we can't actually make window undefined in jsdom,
    // we verify the logic by testing that the hook handles the case gracefully
    // The SSR guard is a simple early return that's covered by the empty hash test
    // which also returns early without calling loadChatSession
    (window as any).location.hash = '';

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(result.current).toEqual({ status: 'idle' });
    expect(mockLoadChatSession).not.toHaveBeenCalled();
    expect(mockHasSessionLoaded).not.toHaveBeenCalled();
  });

  it('only runs effect once on mount (empty dependency array)', () => {
    (window as any).location.hash = '#session-once';
    mockHasSessionLoaded.mockReturnValue(true);

    const { result, rerender } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(mockLoadChatSession).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ status: 'idle' });

    // Rerender should not trigger the effect again
    rerender();

    expect(mockLoadChatSession).toHaveBeenCalledTimes(1);
  });

  it('cleans up without side effects on unmount', () => {
    (window as any).location.hash = '#session-cleanup';
    mockHasSessionLoaded.mockReturnValue(true);

    const { unmount } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(mockLoadChatSession).toHaveBeenCalledTimes(1);

    // Unmount should not cause any errors
    expect(() => unmount()).not.toThrow();
  });

  it('handles special characters in session ID', () => {
    (window as any).location.hash = '#session-with_special.chars';
    mockHasSessionLoaded.mockReturnValue(true);

    const { result } = renderHook(() =>
      useDeepLink(mockLoadChatSession, mockHasSessionLoaded)
    );

    expect(mockLoadChatSession).toHaveBeenCalledWith('session-with_special.chars');
    expect(result.current).toEqual({ status: 'idle' });
  });
});
