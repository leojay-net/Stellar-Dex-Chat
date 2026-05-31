import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SplitViewComparison from '../SplitViewComparison';
import { ChatSession } from '@/types';

// Mock hooks
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => ({
    isOnline: true,
    wasOffline: false,
    resetWasOffline: vi.fn(),
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

describe('SplitViewComparison - Clipboard Copy', () => {
  const mockSessions: ChatSession[] = [
    {
      id: 'session-1',
      title: 'Test Session 1',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello, this is a test message',
          timestamp: new Date('2024-01-01'),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'This is a response message',
          timestamp: new Date('2024-01-01'),
        },
      ],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ];

  const mockSplitView = {
    state: {
      isOpen: true,
      leftSessionId: 'session-1',
      rightSessionId: null,
      selectedMessageId: null,
    },
    open: vi.fn(),
    close: vi.fn(),
    setLeftSession: vi.fn(),
    setRightSession: vi.fn(),
    swapSessions: vi.fn(),
    selectMessage: vi.fn(),
    leftSession: mockSessions[0],
    rightSession: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders copy button on message hover', () => {
    render(
      <SplitViewComparison splitView={mockSplitView} sessions={mockSessions} />,
    );

    const copyButtons = screen.getAllByTestId('copy-message-btn');
    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it('copies message content to clipboard when copy button is clicked', async () => {
    render(
      <SplitViewComparison splitView={mockSplitView} sessions={mockSessions} />,
    );

    const copyButtons = screen.getAllByTestId('copy-message-btn');
    const firstCopyButton = copyButtons[0];

    fireEvent.click(firstCopyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Hello, this is a test message',
      );
    });
  });

  it('shows check icon after successful copy', async () => {
    render(
      <SplitViewComparison splitView={mockSplitView} sessions={mockSessions} />,
    );

    const copyButtons = screen.getAllByTestId('copy-message-btn');
    const firstCopyButton = copyButtons[0];

    fireEvent.click(firstCopyButton);

    await waitFor(() => {
      // Check icon should be visible after copy
      const checkIcon = firstCopyButton.querySelector('svg');
      expect(checkIcon).toBeInTheDocument();
    });
  });

  it('does not trigger message selection when copy button is clicked', async () => {
    render(
      <SplitViewComparison splitView={mockSplitView} sessions={mockSessions} />,
    );

    const copyButtons = screen.getAllByTestId('copy-message-btn');
    const firstCopyButton = copyButtons[0];

    fireEvent.click(firstCopyButton);

    // selectMessage should not be called when clicking copy button
    expect(mockSplitView.selectMessage).not.toHaveBeenCalled();
  });

  it('handles clipboard API failure gracefully', async () => {
    const writeTextMock = vi.fn(() =>
      Promise.reject(new Error('Clipboard error')),
    );
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <SplitViewComparison splitView={mockSplitView} sessions={mockSessions} />,
    );

    const copyButtons = screen.getAllByTestId('copy-message-btn');
    const firstCopyButton = copyButtons[0];

    fireEvent.click(firstCopyButton);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });
  });

  it('copy button is accessible with proper aria labels', () => {
    render(
      <SplitViewComparison splitView={mockSplitView} sessions={mockSessions} />,
    );

    const copyButtons = screen.getAllByTestId('copy-message-btn');
    const firstCopyButton = copyButtons[0];

    expect(firstCopyButton).toHaveAttribute(
      'aria-label',
      'Copy message to clipboard',
    );
    expect(firstCopyButton).toHaveAttribute('title', 'Copy message');
  });
});
