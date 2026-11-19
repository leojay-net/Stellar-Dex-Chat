import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ChatSession } from '@/types';
import { useSplitView } from '@/hooks/useSplitView';
import { renderHook, act } from '@testing-library/react';
import {
  setTelemetryConsent,
  type ChatEvent,
  type SplitViewTelemetryPayload,
} from '@/lib/chatTelemetry';

function makeSession(id: string, title = 'Session'): ChatSession {
  const now = new Date();
  return { id, title, messages: [], createdAt: now, lastUpdated: now };
}

const sessions = [
  makeSession('s1', 'Thread A'),
  makeSession('s2', 'Thread B'),
  makeSession('s3', 'Thread C'),
];

describe('useSplitView – state management', () => {
  it('starts closed with no sessions selected', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    expect(result.current.state.isOpen).toBe(false);
    expect(result.current.state.leftSessionId).toBeNull();
    expect(result.current.state.rightSessionId).toBeNull();
  });

  it('open() sets isOpen=true and assigns leftSessionId', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1'));
    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.leftSessionId).toBe('s1');
  });

  it('open() with two args sets both panes', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    expect(result.current.state.leftSessionId).toBe('s1');
    expect(result.current.state.rightSessionId).toBe('s2');
  });

  it('close() resets all state', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.close());
    expect(result.current.state.isOpen).toBe(false);
    expect(result.current.state.leftSessionId).toBeNull();
    expect(result.current.state.rightSessionId).toBeNull();
    expect(result.current.state.selectedMessageId).toBeNull();
  });

  it('setLeftSession() updates left pane only', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.setLeftSession('s3'));
    expect(result.current.state.leftSessionId).toBe('s3');
    expect(result.current.state.rightSessionId).toBe('s2');
  });

  it('setRightSession() updates right pane only', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.setRightSession('s3'));
    expect(result.current.state.leftSessionId).toBe('s1');
    expect(result.current.state.rightSessionId).toBe('s3');
  });

  it('swapSessions() swaps left and right IDs', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.swapSessions());
    expect(result.current.state.leftSessionId).toBe('s2');
    expect(result.current.state.rightSessionId).toBe('s1');
  });

  it('swapSessions() clears selectedMessageId', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.selectMessage('msg-123'));
    act(() => result.current.swapSessions());
    expect(result.current.state.selectedMessageId).toBeNull();
  });

  it('selectMessage() sets selectedMessageId across both panes', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.selectMessage('msg-abc'));
    expect(result.current.state.selectedMessageId).toBe('msg-abc');
  });

  it('selectMessage(null) clears selection', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.selectMessage('msg-abc'));
    act(() => result.current.selectMessage(null));
    expect(result.current.state.selectedMessageId).toBeNull();
  });

  it('leftSession resolves to the correct session object', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s2', 's3'));
    expect(result.current.leftSession?.id).toBe('s2');
    expect(result.current.leftSession?.title).toBe('Thread B');
  });

  it('rightSession resolves to the correct session object', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's3'));
    expect(result.current.rightSession?.id).toBe('s3');
  });

  it('leftSession is null when id not found in sessions', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('nonexistent'));
    expect(result.current.leftSession).toBeNull();
  });

  it('open() resets selectedMessageId', () => {
    const { result } = renderHook(() => useSplitView(sessions));
    act(() => result.current.open('s1', 's2'));
    act(() => result.current.selectMessage('msg-xyz'));
    act(() => result.current.open('s1', 's3'));
    expect(result.current.state.selectedMessageId).toBeNull();
  });
});

describe('useSplitView – structured telemetry (#1208)', () => {
  function captureEvents(): { events: ChatEvent<SplitViewTelemetryPayload>[] } {
    const box = { events: [] as ChatEvent<SplitViewTelemetryPayload>[] };
    window.addEventListener('chat:telemetry', ((e: Event) => {
      const detail = (e as CustomEvent<ChatEvent<SplitViewTelemetryPayload>>)
        .detail;
      if (detail.name === 'split_view') {
        box.events.push(detail);
      }
    }) as EventListener);
    return box;
  }

  beforeEach(() => {
    setTelemetryConsent(true);
    // `chatTelemetry`'s emitter defers the actual `chat:telemetry`
    // CustomEvent dispatch to `requestAnimationFrame` to avoid blocking
    // renders. Run the callback synchronously here so tests don't depend on
    // real frame timing (which is flaky/inconsistent across jsdom/happy-dom
    // versions when multiple events are scheduled back to back).
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits an "open" event with the session ids when the panel opens', () => {
    const box = captureEvents();
    const { result } = renderHook(() => useSplitView(sessions));

    act(() => {
      result.current.open('s1', 's2');
    });

    expect(box.events).toHaveLength(1);
    expect(box.events[0].payload).toMatchObject({
      action: 'open',
      leftSessionId: 's1',
      rightSessionId: 's2',
    });
  });

  it('emits a "close" event when the panel closes', () => {
    const box = captureEvents();
    const { result } = renderHook(() => useSplitView(sessions));

    act(() => {
      result.current.open('s1', 's2');
    });
    act(() => {
      result.current.close();
    });

    const closeEvents = box.events.filter((e) => e.payload.action === 'close');
    expect(closeEvents).toHaveLength(1);
  });

  it('emits a "swap_sessions" event with the post-swap session ids', () => {
    const box = captureEvents();
    const { result } = renderHook(() => useSplitView(sessions));

    act(() => {
      result.current.open('s1', 's2');
    });
    act(() => {
      result.current.swapSessions();
    });

    const swapEvents = box.events.filter(
      (e) => e.payload.action === 'swap_sessions',
    );
    expect(swapEvents).toHaveLength(1);
    expect(swapEvents[0].payload).toMatchObject({
      leftSessionId: 's2',
      rightSessionId: 's1',
    });
  });

  it('does not emit telemetry without user consent', () => {
    setTelemetryConsent(false);
    const box = captureEvents();
    const { result } = renderHook(() => useSplitView(sessions));

    act(() => {
      result.current.open('s1', 's2');
    });

    expect(box.events).toHaveLength(0);
  });
});
