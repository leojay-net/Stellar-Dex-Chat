'use client';

import { useState, useCallback } from 'react';
import { ChatSession } from '@/types';
import { chatTelemetry } from '@/lib/chatTelemetry';

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
    setState((prev) => {
      const nextRightSessionId = rightId ?? prev.rightSessionId;
      // Structured telemetry (#1208): record split-view opens, including
      // which two threads are being compared, so product/analytics can see
      // how often this feature is used. `chatTelemetry` is the existing,
      // consent-gated telemetry pipeline used across the app (payment
      // status, wallet connect, etc.) - reused here rather than inventing a
      // new analytics mechanism.
      chatTelemetry.splitView({
        action: 'open',
        leftSessionId: leftId,
        rightSessionId: nextRightSessionId,
      });
      return {
        ...prev,
        isOpen: true,
        leftSessionId: leftId,
        rightSessionId: nextRightSessionId,
        selectedMessageId: null,
      };
    });
  }, []);

  const close = useCallback(() => {
    chatTelemetry.splitView({ action: 'close' });
    setState({
      isOpen: false,
      leftSessionId: null,
      rightSessionId: null,
      selectedMessageId: null,
    });
  }, []);

  const setLeftSession = useCallback((id: string) => {
    chatTelemetry.splitView({ action: 'set_left_session', leftSessionId: id });
    setState((prev) => ({
      ...prev,
      leftSessionId: id,
      selectedMessageId: null,
    }));
  }, []);

  const setRightSession = useCallback((id: string) => {
    chatTelemetry.splitView({
      action: 'set_right_session',
      rightSessionId: id,
    });
    setState((prev) => ({
      ...prev,
      rightSessionId: id,
      selectedMessageId: null,
    }));
  }, []);

  const swapSessions = useCallback(() => {
    setState((prev) => {
      chatTelemetry.splitView({
        action: 'swap_sessions',
        leftSessionId: prev.rightSessionId,
        rightSessionId: prev.leftSessionId,
      });
      return {
        ...prev,
        leftSessionId: prev.rightSessionId,
        rightSessionId: prev.leftSessionId,
        selectedMessageId: null,
      };
    });
  }, []);

  const selectMessage = useCallback((messageId: string | null) => {
    if (messageId !== null) {
      chatTelemetry.splitView({ action: 'select_message' });
    }
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
