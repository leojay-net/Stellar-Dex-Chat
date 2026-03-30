'use client';

import { useState, useCallback } from 'react';
import { ChatSession } from '@/types';

export interface SplitViewState {
  isOpen: boolean;
  leftSessionId: string | null;
  rightSessionId: string | null;
  selectedMessageId: string | null;
}

export interface UseSplitViewReturn {
  state: SplitViewState;
  open: (leftId: string, rightId?: string) => void;
  close: () => void;
  setLeftSession: (id: string) => void;
  setRightSession: (id: string) => void;
  swapSessions: () => void;
  selectMessage: (messageId: string | null) => void;
  /** Resolved session objects (may be null if id not found in `sessions`). */
  leftSession: ChatSession | null;
  rightSession: ChatSession | null;
}

/**
 * Manages the state for the split-view two-thread comparison panel.
 *
 * - `leftSessionId` / `rightSessionId` track which threads are compared.
 * - `selectedMessageId` enables synchronized message selection across panes.
 * - `swapSessions` swaps the two thread positions without losing state.
 */
export function useSplitView(sessions: ChatSession[]): UseSplitViewReturn {
  const [state, setState] = useState<SplitViewState>({
    isOpen: false,
    leftSessionId: null,
    rightSessionId: null,
    selectedMessageId: null,
  });

  const findSession = useCallback(
    (id: string | null): ChatSession | null => {
      if (!id) return null;
      return sessions.find((s) => s.id === id) ?? null;
    },
    [sessions],
  );

  const open = useCallback((leftId: string, rightId?: string) => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      leftSessionId: leftId,
      rightSessionId: rightId ?? prev.rightSessionId,
      selectedMessageId: null,
    }));
  }, []);

  const close = useCallback(() => {
    setState({
      isOpen: false,
      leftSessionId: null,
      rightSessionId: null,
      selectedMessageId: null,
    });
  }, []);

  const setLeftSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, leftSessionId: id, selectedMessageId: null }));
  }, []);

  const setRightSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, rightSessionId: id, selectedMessageId: null }));
  }, []);

  const swapSessions = useCallback(() => {
    setState((prev) => ({
      ...prev,
      leftSessionId: prev.rightSessionId,
      rightSessionId: prev.leftSessionId,
      selectedMessageId: null,
    }));
  }, []);

  const selectMessage = useCallback((messageId: string | null) => {
    setState((prev) => ({ ...prev, selectedMessageId: messageId }));
  }, []);

  return {
    state,
    open,
    close,
    setLeftSession,
    setRightSession,
    swapSessions,
    selectMessage,
    leftSession: findSession(state.leftSessionId),
    rightSession: findSession(state.rightSessionId),
  };
}
