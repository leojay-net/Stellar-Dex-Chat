import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotifications } from './useNotifications';

type NotificationTelemetryDetail = {
  event: string;
  id?: string;
  type?: string;
  message?: string;
  severity?: string;
  read?: boolean;
  timestamp?: number;
};

function captureNotificationTelemetry(): Promise<NotificationTelemetryDetail> {
  return new Promise((resolve) => {
    window.addEventListener(
      'notification_telemetry',
      (event) =>
        resolve((event as CustomEvent<NotificationTelemetryDetail>).detail),
      { once: true },
    );
  });
}

describe('useNotifications telemetry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('dispatches structured notification telemetry when a notification is added', async () => {
    const eventPromise = captureNotificationTelemetry();
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification('tx_submit', 'Transaction submitted');
    });

    await expect(eventPromise).resolves.toMatchObject({
      event: 'notification_added',
      type: 'tx_submit',
      message: 'Transaction submitted',
      severity: 'info',
      read: false,
    });
  });

  it('dispatches telemetry when a notification is marked as read', async () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification('payout_success', 'Payout succeeded');
    });

    const notifications = result.current.notifications;
    expect(notifications[0]).toBeDefined();

    const eventPromise = captureNotificationTelemetry();
    act(() => {
      result.current.markAsRead(notifications[0].id);
    });

    await expect(eventPromise).resolves.toMatchObject({
      event: 'notification_marked_read',
      id: notifications[0].id,
    });
  });
});
