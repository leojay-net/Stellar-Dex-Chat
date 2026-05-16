import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationsCenter from '../NotificationsCenter';

const useNotificationsMock = vi.fn();
const useThemeMock = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => useNotificationsMock(),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => useThemeMock(),
}));

describe('NotificationsCenter error boundary', () => {
  beforeEach(() => {
    useNotificationsMock.mockReturnValue({
      notifications: [],
      unreadCount: 0,
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
      clearNotifications: vi.fn(),
    });
    useThemeMock.mockReturnValue({ isDarkMode: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useNotificationsMock.mockReset();
    useThemeMock.mockReset();
  });

  it('renders the notifications trigger during normal operation', () => {
    render(<NotificationsCenter />);

    expect(
      screen.getByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
  });

  it('shows a compact fallback when notifications crash', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    useNotificationsMock.mockImplementation(() => {
      throw new Error('notifications unavailable');
    });

    render(<NotificationsCenter />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Notifications are unavailable.',
    );
    expect(
      screen.getByRole('button', { name: 'Notifications unavailable' }),
    ).toBeDisabled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
