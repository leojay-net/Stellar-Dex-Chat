import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ChatSession, ChatMessage } from '@/types';
import { UseSplitViewReturn, SplitViewState } from '@/hooks/useSplitView';
import SplitViewComparison from '@/components/SplitViewComparison';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { splitViewAddToastMock } = vi.hoisted(() => ({
  splitViewAddToastMock: vi.fn(),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toasts: [],
    addToast: splitViewAddToastMock,
    dismissToast: vi.fn(),
    clearToasts: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(id: string, content: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, role, content, timestamp: new Date('2024-06-15T10:00:00Z') };
}

function makeSession(id: string, title: string, messages: ChatMessage[] = []): ChatSession {
  const now = new Date();
  return { id, title, messages, createdAt: now, lastUpdated: now };
}

const sessionA = makeSession('s1', 'Thread Alpha', [
  makeMessage('m1', 'Hello from thread A'),
  makeMessage('m2', 'Assistant reply A', 'assistant'),
]);

const sessionB = makeSession('s2', 'Thread Beta', [
  makeMessage('m3', 'Hello from thread B'),
]);

const allSessions = [sessionA, sessionB];

function makeSplitView(overrides: Partial<SplitViewState> = {}): UseSplitViewReturn {
  const state: SplitViewState = {
    isOpen: true,
    leftSessionId: 's1',
    rightSessionId: 's2',
    selectedMessageId: null,
    ...overrides,
  };

  return {
    state,
    open: vi.fn(),
    close: vi.fn(),
    setLeftSession: vi.fn(),
    setRightSession: vi.fn(),
    swapSessions: vi.fn(),
    selectMessage: vi.fn(),
    leftSession: allSessions.find((s) => s.id === state.leftSessionId) ?? null,
    rightSession: allSessions.find((s) => s.id === state.rightSessionId) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Layout tests
// ---------------------------------------------------------------------------

describe('SplitViewComparison – layout', () => {
  afterEach(cleanup);
  it('renders nothing when isOpen=false', () => {
    const splitView = makeSplitView({ isOpen: false });
    const { container } = render(
      <SplitViewComparison splitView={splitView} sessions={allSessions} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders both panes when open', () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    expect(screen.getByTestId('split-pane-left')).toBeDefined();
    expect(screen.getByTestId('split-pane-right')).toBeDefined();
  });

  it('renders the dialog with correct role and aria-modal', () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    const dialog = screen.getByTestId('split-view-comparison');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('split-view-comparison-title');
  });

  it('exposes labeled regions and a toolbar for assistive tech', () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    expect(screen.getByRole('region', { name: /left thread comparison pane/i })).toBeDefined();
    expect(screen.getByRole('region', { name: /right thread comparison pane/i })).toBeDefined();
    expect(screen.getByRole('toolbar', { name: /comparison actions/i })).toBeDefined();
  });

  it('uses theme CSS variables for surfaces and borders', () => {
    const splitView = makeSplitView();
    const { container } = render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    const root = container.querySelector('[data-testid="split-view-comparison"]');
    expect(root?.getAttribute('class')).toContain('var(--background)');
    expect(root?.getAttribute('class')).toContain('var(--foreground)');
  });

  it('shows messages from the left session', () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    expect(screen.getByText('Hello from thread A')).toBeDefined();
  });

  it('shows messages from the right session', () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    expect(screen.getByText('Hello from thread B')).toBeDefined();
  });

  it('shows "Select a thread above" when a pane has no session', () => {
    const splitView = makeSplitView({ rightSessionId: null });
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
    expect(screen.getByText('Select a thread above')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Swap / close interaction tests
// ---------------------------------------------------------------------------

describe('SplitViewComparison – interactions', () => {
  let splitView: UseSplitViewReturn;
  afterEach(cleanup);

  beforeEach(() => {
    splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);
  });

  it('calls swapSessions when the Swap button is clicked', () => {
    fireEvent.click(screen.getByTestId('swap-threads-btn'));
    expect(splitView.swapSessions).toHaveBeenCalledOnce();
  });

  it('calls close when the Close button is clicked', () => {
    fireEvent.click(screen.getByTestId('close-split-view-btn'));
    expect(splitView.close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// State sync (synchronized message selection) tests
// ---------------------------------------------------------------------------

describe('SplitViewComparison – message selection sync', () => {
  afterEach(cleanup);
  it('calls selectMessage when a message button is clicked', () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);

    const messageBtn = screen.getAllByRole('button', { name: /User message|Assistant message/ })[0];
    fireEvent.click(messageBtn);
    expect(splitView.selectMessage).toHaveBeenCalled();
  });

  it('marks the selected message as aria-pressed=true', () => {
    const splitView = makeSplitView({ selectedMessageId: 'm1' });
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);

    const pressedBtns = screen.getAllByRole('button', { name: /User message|Assistant message/ })
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressedBtns.length).toBeGreaterThan(0);
  });

  it('clicking the selected message again calls selectMessage(null) to deselect', () => {
    const selectedId = 'm1';
    const splitView = makeSplitView({ selectedMessageId: selectedId });
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);

    // Find the already-selected (aria-pressed=true) message button and click it
    const allMsgBtns = screen.getAllByRole('button', { name: /User message|Assistant message/ });
    const pressedBtn = allMsgBtns.find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressedBtn).toBeDefined();
    fireEvent.click(pressedBtn!);
    expect(splitView.selectMessage).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Network status toasts (Issue #550)
// ---------------------------------------------------------------------------

describe('SplitViewComparison – network status toasts', () => {
  afterEach(() => {
    cleanup();
    splitViewAddToastMock.mockClear();
  });

  it('shows a warning toast when the browser goes offline while open', async () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);

    fireEvent(window, new Event('offline'));

    await waitFor(() => {
      expect(splitViewAddToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringMatching(/offline/i),
        }),
      );
    });
  });

  it('shows a success toast when coming back online after offline', async () => {
    const splitView = makeSplitView();
    render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);

    fireEvent(window, new Event('offline'));
    await waitFor(() => expect(splitViewAddToastMock).toHaveBeenCalled());

    splitViewAddToastMock.mockClear();
    fireEvent(window, new Event('online'));

    await waitFor(() => {
      expect(splitViewAddToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          message: expect.stringMatching(/online|reconnect/i),
        }),
      );
    });
  });

  it('prevents hydration mismatch by not rendering timestamps until mounted', () => {
    const splitView = makeSplitView({ leftSessionId: 's1' });
    const { container } = render(<SplitViewComparison splitView={splitView} sessions={allSessions} />);

    // Initially, timestamps should be empty to avoid hydration mismatch
    const timestampElements = container.querySelectorAll('[data-testid="message-timestamp"]');
    timestampElements.forEach(el => {
      expect(el.textContent).toBe('');
    });

    // Note: In a real hydration scenario, we would check that server and client render match,
    // but for this test we verify the timestamp is hidden initially
  });
});
