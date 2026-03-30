import { describe, expect, it } from 'vitest';
import { ChatSession } from '@/types';
import { useSplitView } from '@/hooks/useSplitView';
import { renderHook, act } from '@testing-library/react';

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
