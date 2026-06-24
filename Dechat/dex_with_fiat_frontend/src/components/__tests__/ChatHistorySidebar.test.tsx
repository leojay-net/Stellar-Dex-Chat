import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import ChatHistorySidebar from '@/components/ChatHistorySidebar';
import type { ChatSession } from '@/types';

// ─── Shared mutable state so individual tests can override values ──────────
let mockPinnedSessions: ChatSession[] = [];
let mockUnpinnedSessions: ChatSession[] = [];
let mockAllSessions: ChatSession[] = [];
let mockCurrentSessionId: string | null = null;
const mockDeleteSession = vi.fn();
const mockClearAllHistory = vi.fn();
const mockTogglePin = vi.fn();

vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: () => ({
    pinnedSessions: mockPinnedSessions,
    unpinnedSessions: mockUnpinnedSessions,
    currentSessionId: mockCurrentSessionId,
    sessions: mockAllSessions,
    deleteSession: mockDeleteSession,
    clearAllHistory: mockClearAllHistory,
    exportSessionAsJSON: vi.fn(),
    exportSessionAsTXT: vi.fn(),
    searchSessions: vi.fn(() => []),
    togglePin: mockTogglePin,
    hasHistory: mockAllSessions.length > 0,
  }),
}));

vi.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({
    entries: [],
    clearEntries: vi.fn(),
    updateEntry: vi.fn(),
  }),
}));

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: { address: null as string | null },
  }),
}));

vi.mock('@/components/PriceTicker', () => ({ default: () => null }));
vi.mock('@/components/ui/skeleton/SkeletonSidebar', () => ({ default: () => null }));

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeSession(id: string, overrides?: Partial<ChatSession>): ChatSession {
  return {
    id,
    title: `Chat ${id}`,
    messages: [],
    createdAt: new Date(),
    lastUpdated: new Date(),
    pinned: false,
    ...overrides,
  };
}

/** Render the sidebar and advance past the 800ms loading skeleton */
async function renderAndLoad(props?: Partial<React.ComponentProps<typeof ChatHistorySidebar>>) {
  const result = render(
    <ChatHistorySidebar onLoadSession={vi.fn()} isCollapsed={false} {...props} />,
  );
  // Advance the 800ms loading timer
  await act(async () => { vi.advanceTimersByTime(900); });
  return result;
}

describe('ChatHistorySidebar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    } as Response);
    mockPinnedSessions = [];
    mockUnpinnedSessions = [];
    mockAllSessions = [];
    mockCurrentSessionId = null;
    mockDeleteSession.mockReset();
    mockClearAllHistory.mockReset();
    mockTogglePin.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Regression (#651): root chrome must use theme border color so the sidebar
   * separator matches the rest of the layout (not Tailwind's default border color).
   */
  it('applies theme border color to the root sidebar chrome', async () => {
    const { container } = await renderAndLoad();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\btheme-border\b/);
    expect(root.className).toMatch(/\bborder-r\b/);
  });

  it('auto-scrolls the active conversation into view when rendered', async () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);

    const sessionA = makeSession('a1');
    const sessionB = makeSession('a2');
    mockUnpinnedSessions = [sessionA, sessionB];
    mockAllSessions = [sessionA, sessionB];
    mockCurrentSessionId = 'a2';

    await renderAndLoad();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('re-scrolls the active conversation after the active session changes', async () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);

    const sessionA = makeSession('b1');
    const sessionB = makeSession('b2');
    mockUnpinnedSessions = [sessionA, sessionB];
    mockAllSessions = [sessionA, sessionB];
    mockCurrentSessionId = 'b1';

    const { rerender } = render(
      <ChatHistorySidebar onLoadSession={vi.fn()} isCollapsed={false} />,
    );
    await act(async () => { vi.advanceTimersByTime(900); });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    mockCurrentSessionId = 'b2';
    rerender(<ChatHistorySidebar onLoadSession={vi.fn()} isCollapsed={false} />);
    await act(async () => {});

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('shows undo toast after session delete and does not call deleteSession immediately', async () => {
    const session = makeSession('s1');
    mockUnpinnedSessions = [session];
    mockAllSessions = [session];

    await renderAndLoad();

    // Click delete → confirm dialog appears → click Delete
    fireEvent.click(screen.getByTitle('Delete conversation'));
    fireEvent.click(screen.getByText('Delete'));

    // deleteSession should NOT be called immediately (optimistic)
    expect(mockDeleteSession).not.toHaveBeenCalled();

    // Undo toast should be visible
    expect(screen.getByText('Conversation deleted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('calls deleteSession after the undo timeout expires', async () => {
    const session = makeSession('s2');
    mockUnpinnedSessions = [session];
    mockAllSessions = [session];

    await renderAndLoad();

    fireEvent.click(screen.getByTitle('Delete conversation'));
    fireEvent.click(screen.getByText('Delete'));

    // Advance past the 5s undo window
    await act(async () => { vi.advanceTimersByTime(5100); });

    expect(mockDeleteSession).toHaveBeenCalledWith('s2');
  });

  it('does NOT call deleteSession when undo is clicked within the window', async () => {
    const session = makeSession('s3');
    mockUnpinnedSessions = [session];
    mockAllSessions = [session];

    await renderAndLoad();

    fireEvent.click(screen.getByTitle('Delete conversation'));
    fireEvent.click(screen.getByText('Delete'));

    // Click Undo before the timer fires
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await act(async () => { vi.advanceTimersByTime(5100); });

    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(screen.queryByText('Conversation deleted')).toBeNull();
  });

  it('calls togglePin immediately on pin button click', async () => {
    const session = makeSession('s4');
    mockUnpinnedSessions = [session];
    mockAllSessions = [session];

    await renderAndLoad();

    fireEvent.click(screen.getByTitle('Pin conversation'));

    expect(mockTogglePin).toHaveBeenCalledWith('s4');
  });

  it('applies animate-bounce-once class to pin icon and removes it after 600ms', async () => {
    const session = makeSession('s5');
    mockUnpinnedSessions = [session];
    mockAllSessions = [session];

    await renderAndLoad();

    fireEvent.click(screen.getByTitle('Pin conversation'));

    // Animation class should be applied
    const pinBtn = screen.getByTitle('Pin conversation');
    const svg = pinBtn.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('animate-bounce-once');

    // After 600ms the animation class should be removed
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(svg?.getAttribute('class')).not.toContain('animate-bounce-once');
  });

  it('shows undo toast after clear-all and calls clearAllHistory immediately', async () => {
    const sessions = [makeSession('c1'), makeSession('c2')];
    mockUnpinnedSessions = sessions;
    mockAllSessions = sessions;

    await renderAndLoad();

    fireEvent.click(screen.getByTitle('Clear all history'));

    expect(mockClearAllHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('History cleared')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();

    // Toast disappears after timeout
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByText('History cleared')).toBeNull();
  });
});

// ── Issue #633 regression: error boundary wraps ChatHistorySidebar ─────────────
describe('ChatHistorySidebar error boundary (#633)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    } as Response);
    mockPinnedSessions = [];
    mockUnpinnedSessions = [];
    mockAllSessions = [];
    // Suppress React's error boundary console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders the fallback UI when a child throws and not the crash stack', async () => {
    vi.doMock('@/components/PriceTicker', () => ({
      default: () => {
        throw new Error('PriceTicker exploded');
      },
    }));
    vi.resetModules();

    const { default: ChatHistorySidebarFresh } = await import('@/components/ChatHistorySidebar');

    await act(async () => {
      render(
        <ChatHistorySidebarFresh onLoadSession={vi.fn()} isCollapsed={false} />,
      );
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(screen.getByText('Sidebar unavailable')).toBeTruthy();
    expect(screen.queryByText('PriceTicker exploded')).toBeNull();

    vi.doUnmock('@/components/PriceTicker');
    vi.resetModules();
  });

  it('displays the custom retry label from the error boundary props', async () => {
    vi.doMock('@/components/PriceTicker', () => ({
      default: () => {
        throw new Error('forced');
      },
    }));
    vi.resetModules();

    const { default: ChatHistorySidebarFresh } = await import('@/components/ChatHistorySidebar');

    await act(async () => {
      render(
        <ChatHistorySidebarFresh onLoadSession={vi.fn()} isCollapsed={false} />,
      );
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(screen.getByRole('button', { name: /reload sidebar/i })).toBeTruthy();

    vi.doUnmock('@/components/PriceTicker');
    vi.resetModules();
  });
});
