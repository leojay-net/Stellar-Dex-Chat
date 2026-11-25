import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
} from '@testing-library/react';
import { useNotifications } from '@/hooks/useNotifications';
import '@testing-library/jest-dom';
import NotificationsCenter from '../NotificationsCenter';

const mockMarkAllAsRead = vi.fn();
const mockClearNotifications = vi.fn();
const mockMarkAsRead = vi.fn();
const mockAddNotification = vi.fn();
const mockSetNotifications = vi.fn();
const emptyNotifications: ReturnType<typeof useNotifications>['notifications'] =
  [];

function resetNotificationsMock() {
  vi.mocked(useNotifications).mockImplementation(() => ({
    notifications: emptyNotifications,
    unreadCount: 0,
    addNotification: mockAddNotification,
    setNotifications: mockSetNotifications,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
    clearNotifications: mockClearNotifications,
  }));
}

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(() => ({
    notifications: emptyNotifications,
    unreadCount: 0,
    addNotification: mockAddNotification,
    setNotifications: mockSetNotifications,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
    clearNotifications: mockClearNotifications,
  })),
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

async function openNotificationsPanel() {
  render(<NotificationsCenter />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
}

describe('NotificationsCenter – rendering', () => {
  beforeEach(() => {
    resetNotificationsMock();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetNotificationsMock();
  });

  it('renders the bell button', () => {
    render(<NotificationsCenter />);
    expect(
      screen.getByRole('button', { name: /notifications/i }),
    ).toBeInTheDocument();
  });

  it('does not show the dropdown initially', () => {
    render(<NotificationsCenter />);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('shows the dropdown when the bell button is clicked', async () => {
    await openNotificationsPanel();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('shows unread badge when there are unread notifications', async () => {
    const notifications = [makeNotification()];
    vi.mocked(useNotifications).mockReturnValue({
      notifications,
      unreadCount: 1,
      addNotification: mockAddNotification,
      setNotifications: mockSetNotifications,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    render(<NotificationsCenter />);
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('bell button exposes aria-expanded reflecting open state', () => {
    render(<NotificationsCenter />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows "No notifications yet" when list is empty and panel is open', async () => {
    await openNotificationsPanel();
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
  });
});

describe('NotificationsCenter – dynamic theme tokens (#816)', () => {
  beforeEach(() => {
    resetNotificationsMock();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetNotificationsMock();
  });

  it('styles the dropdown panel with theme tokens instead of static light/dark classes', async () => {
    await openNotificationsPanel();
    const panel = screen
      .getByText('Notifications')
      .closest('div[class*="absolute"]');
    expect(panel).toHaveClass('bg-[var(--color-surface)]');
    expect(panel).toHaveClass('border-[var(--color-border)]');
    // No hardcoded gray/white palette classes should remain on the panel.
    expect(panel?.className).not.toMatch(/\bbg-(white|gray-\d+)\b/);
  });

  it('styles the bell trigger button with theme tokens', () => {
    render(<NotificationsCenter />);
    const button = screen.getByRole('button', { name: /notifications/i });
    expect(button).toHaveClass('text-[var(--color-text-muted)]');
    expect(button.className).not.toMatch(/\btext-gray-\d+\b/);
  });

  it('renders identically regardless of the OS/user color-scheme preference, since theming is driven by CSS tokens, not component state', async () => {
    await openNotificationsPanel();
    const panelBefore = screen
      .getByText('Notifications')
      .closest('div[class*="absolute"]')?.className;
    cleanup();
    resetNotificationsMock();

    await openNotificationsPanel();
    const panelAfter = screen
      .getByText('Notifications')
      .closest('div[class*="absolute"]')?.className;

    expect(panelBefore).toBe(panelAfter);
  });

  it('does not import or depend on ThemeContext', () => {
    // NotificationsCenter no longer needs useTheme/isDarkMode branching now
    // that colors come from CSS custom properties which flip automatically
    // with the document's data-theme attribute.
    const source = NotificationsCenter.toString();
    expect(source).not.toMatch(/isDarkMode/);
  });

  it('marks an unread notification with the primary-soft token background', async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [makeNotification({ read: false })],
      unreadCount: 1,
      addNotification: mockAddNotification,
      setNotifications: mockSetNotifications,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotifications: mockClearNotifications,
    });

    await openNotificationsPanel();
    const row = screen
      .getByText('Transaction confirmed')
      .closest('div[class*="flex gap-3"]');
    expect(row).toHaveClass('bg-[var(--color-primary-soft)]');
  });
});

describe('NotificationsCenter – keyboard shortcuts', () => {
  beforeEach(() => {
    resetNotificationsMock();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetNotificationsMock();
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
      addNotification: mockAddNotification,
      setNotifications: mockSetNotifications,
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
      addNotification: mockAddNotification,
      setNotifications: mockSetNotifications,
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
      addNotification: mockAddNotification,
      setNotifications: mockSetNotifications,
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
      addNotification: mockAddNotification,
      setNotifications: mockSetNotifications,
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
      </>,
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
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
    removeEventListenerSpy.mockRestore();
  });
});

describe('NotificationsCenter – click-outside', () => {
  beforeEach(() => {
    resetNotificationsMock();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetNotificationsMock();
  });

  it('closes when clicking outside the dropdown', () => {
    render(
      <div>
        <NotificationsCenter />
        <div data-testid="outside">outside</div>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});
