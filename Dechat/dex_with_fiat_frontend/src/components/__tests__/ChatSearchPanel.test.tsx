import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ChatSearchPanel from '../ChatSearchPanel';
import { ChatMessage, ChatSession } from '@/types';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

function makeMessage(overrides: Partial<ChatMessage> & { content: string }): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role: 'assistant',
    timestamp: new Date('2024-06-15T12:00:00Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Test Chat',
    messages: [],
    createdAt: new Date('2024-06-15'),
    lastUpdated: new Date('2024-06-15'),
    ...overrides,
  };
}

describe('ChatSearchPanel – keyboard shortcuts (#1183)', () => {
  afterEach(cleanup);

  function renderPanel() {
    const sessions: ChatSession[] = [
      makeSession({
        id: 'session-1',
        title: 'Bridging XLM',
        messages: [makeMessage({ id: 'm1', content: 'How do I bridge XLM to USDC?' })],
      }),
      makeSession({
        id: 'session-2',
        title: 'Wallet setup',
        messages: [makeMessage({ id: 'm2', content: 'Connect your XLM wallet first' })],
      }),
    ];
    const onSelectResult = vi.fn();
    const onClose = vi.fn();
    const utils = render(
      <ChatSearchPanel sessions={sessions} onSelectResult={onSelectResult} onClose={onClose} />,
    );
    return { ...utils, onSelectResult, onClose };
  }

  it('selects the first result with Enter after typing a search', async () => {
    const { onSelectResult, container } = renderPanel();
    const input = screen.getByLabelText('Search keyword');
    const root = container.firstChild as HTMLElement;

    fireEvent.change(input, { target: { value: 'XLM' } });
    // Wait for the debounced search (300ms) to actually populate results,
    // not just for the (synchronously-rendered) results container to exist.
    // Generous timeout: real (non-fake) timers under a loaded test runner.
    await screen.findByText('Bridging XLM', {}, { timeout: 3000 });
    await screen.findByRole('option', { selected: true });

    fireEvent.keyDown(root, { key: 'Enter' });

    expect(onSelectResult).toHaveBeenCalledWith('session-1', 'm1');
  });

  it('moves the active result with ArrowDown before selecting', async () => {
    const { onSelectResult, container } = renderPanel();
    const input = screen.getByLabelText('Search keyword');
    const root = container.firstChild as HTMLElement;

    fireEvent.change(input, { target: { value: 'XLM' } });
    await screen.findByText('Wallet setup', {}, { timeout: 3000 });
    await screen.findByRole('option', { selected: true });

    fireEvent.keyDown(root, { key: 'ArrowDown' });
    fireEvent.keyDown(root, { key: 'Enter' });

    expect(onSelectResult).toHaveBeenCalledWith('session-2', 'm2');
  });

  it('still closes on Escape', async () => {
    const { onClose, container } = renderPanel();
    const root = container.firstChild as HTMLElement;

    fireEvent.keyDown(root, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
