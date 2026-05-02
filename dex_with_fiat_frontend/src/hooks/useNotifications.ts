import { useSyncExternalStore } from 'react';
import { toastStore, ToastSeverity } from '@/lib/toastStore';

export type NotificationType =
  | 'tx_submit'
  | 'tx_confirm'
  | 'payout_pending'
  | 'payout_success'
  | 'payout_fail'
  | 'payout_cancelled'
  | 'risk_warning';

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  read: boolean;
}

const NOTIFICATION_TO_SEVERITY: Record<NotificationType, ToastSeverity> = {
  tx_submit: 'info',
  tx_confirm: 'success',
  payout_pending: 'warning',
  payout_success: 'success',
  payout_fail: 'error',
  payout_cancelled: 'warning',
  risk_warning: 'warning',
};

class NotificationStore {
  private notifications: AppNotification[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('stellar_notifications');
      if (stored) {
        try {
          this.notifications = JSON.parse(stored);
        } catch (e) {
          console.error('Failed to parse notifications', e);
        }
      }
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'stellar_notifications',
        JSON.stringify(this.notifications),
      );
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot() {
    return this.notifications;
  }

  addNotification(type: NotificationType, message: string) {
    const newNotif: AppNotification = {
      id: crypto.randomUUID(),
      type,
      message,
      timestamp: Date.now(),
      read: false,
    };

    this.notifications = [newNotif, ...this.notifications].slice(0, 50); // Keep last 50
    this.emit();

    toastStore.addToast({
      message,
      severity: NOTIFICATION_TO_SEVERITY[type],
    });
  }

  markAsRead(id: string) {
    this.notifications = this.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    this.emit();
  }

  markAllAsRead() {
    this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
    this.emit();
  }

  clearNotifications() {
    this.notifications = [];
    this.emit();
  }
}

export const notificationStore = new NotificationStore();

const EMPTY_ARRAY: AppNotification[] = [];

export function useNotifications() {
  const notifications = useSyncExternalStore(
    (listener) => notificationStore.subscribe(listener),
    () => notificationStore.getSnapshot(),
    () => EMPTY_ARRAY,
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    addNotification: notificationStore.addNotification.bind(notificationStore),
    markAsRead: notificationStore.markAsRead.bind(notificationStore),
    markAllAsRead: notificationStore.markAllAsRead.bind(notificationStore),
    clearNotifications:
      notificationStore.clearNotifications.bind(notificationStore),
  };
}
