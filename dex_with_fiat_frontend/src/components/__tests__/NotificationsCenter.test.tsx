import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useNotifications } from '@/hooks/useNotifications';
import '@testing-library/jest-dom';
import NotificationsCenter from '../NotificationsCenter';

const mockMarkAllAsRead = vi.fn();
const mockClearNotifications = vi.fn();
const mockMarkAsRead = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(() => ({
    notifications: [],
    unreadCount: 0,
    markAsRead: mockMarkAllAsRead,
    markAllAsRead: mockMarkAllAsRead,
    clearNotifications: mockClearNotifications,
  })),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isDarkMode: true })),
}));

vi.mock('lucide-react', () => ({
  Bell: () => <svg data-testid="bell-icon" />,
  Check: () => <svg data-testid="check-icon" />,
  Trash2: () => <svg data-testid="trash-icon" />,
  X: () => <svg data-testid="x-icon" />,
}));

function makeNotification(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'tx_confirm' as const,
    message: 'Transaction confirmed',
    timestamp: Date.now(),
    read: false,
    ...overrides,
  };
}

describe('NotificationsCenter – rendering', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the bell button', () => {
    render(<NotificationsCenter />);
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('does not show the dropdown initially', () => {
    render(<NotificationsCenter />);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('shows the dropdown when the bell button is clicked', () => {
    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('shows unread badge when there are unread notifications', () => {
    vi.mocked(useNotifications).mockReturnValueOnce({
      notifications: [makeNotification()],
      unreadCount: 1,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    render(<NotificationsCenter />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('bell button exposes aria-expanded reflecting open state', () => {
    render(<NotificationsCenter />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows "No notifications yet" when list is empty and panel is open', () => {
    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
  });
});

describe('NotificationsCenter – keyboard shortcuts', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Escape closes the panel when it is open', () => {
    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('Escape does nothing when the panel is already closed', () => {
    render(<NotificationsCenter />);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('m key marks all as read when panel is open', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [makeNotification()],
      unreadCount: 1,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    fireEvent.keyDown(document, { key: 'm' });
    expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('M key (uppercase) also marks all as read', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [makeNotification()],
      unreadCount: 1,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    fireEvent.keyDown(document, { key: 'M' });
    expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('d key clears all notifications when panel is open', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [makeNotification()],
      unreadCount: 1,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    fireEvent.keyDown(document, { key: 'd' });
    expect(mockClearNotifications).toHaveBeenCalledTimes(1);
  });

  it('D key (uppercase) also clears notifications', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [makeNotification()],
      unreadCount: 1,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    render(<NotificationsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    fireEvent.keyDown(document, { key: 'D' });
    expect(mockClearNotifications).toHaveBeenCalledTimes(1);
  });

  it('m key does NOT trigger markAllAsRead when panel is closed', () => {
    render(<NotificationsCenter />);
    // Panel is closed — shortcut should be ignored
    fireEvent.keyDown(document, { key: 'm' });
    expect(mockMarkAllAsRead).not.toHaveBeenCalled();
  });

  it('d key does NOT trigger clearNotifications when panel is closed', () => {
    render(<NotificationsCenter />);
    fireEvent.keyDown(document, { key: 'd' });
    expect(mockClearNotifications).not.toHaveBeenCalled();
  });

  it('shortcuts are ignored when focus is inside an input element', () => {
    render(
      <>
        <NotificationsCenter />
        <input data-testid="text-input" />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    const input = screen.getByTestId('text-input');
    fireEvent.keyDown(input, { key: 'Escape', target: input });

    // Panel should still be open because shortcut was from inside an input
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('cleans up keydown listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<NotificationsCenter />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });
});

describe('NotificationsCenter – click-outside', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('closes when clicking outside the dropdown', () => {
    render(
      <div>
        <NotificationsCenter />
        <div data-testid="outside">outside</div>
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});
