'use client';

import { useEffect, useState } from 'react';
import NotificationsCenter from '@/components/NotificationsCenter';
import { notificationStore, AppNotification } from '@/hooks/useNotifications';

export default function TestNotificationsCenterPage() {
  const [scenario, setScenario] = useState<'empty' | 'with-notifications' | 'all-read' | 'mixed'>('empty');

  useEffect(() => {
    switch (scenario) {
      case 'empty':
        notificationStore.clearNotifications();
        break;
      case 'with-notifications':
        notificationStore.clearNotifications();
        notificationStore.addNotification('tx_submit', 'Transaction submitted to network');
        notificationStore.addNotification('payout_pending', 'Payout of 100 USDC is pending');
        notificationStore.addNotification('risk_warning', 'High slippage detected on XLM/USDC');
        break;
      case 'all-read':
        notificationStore.clearNotifications();
        const readNotif1: AppNotification = {
          id: 'read-1',
          type: 'tx_confirm',
          message: 'Transaction confirmed on ledger',
          timestamp: Date.now() - 3600000,
          read: true,
        };
        const readNotif2: AppNotification = {
          id: 'read-2',
          type: 'payout_success',
          message: 'Payout completed successfully',
          timestamp: Date.now() - 7200000,
          read: true,
        };
        notificationStore.setNotifications([readNotif1, readNotif2]);
        break;
      case 'mixed':
        notificationStore.clearNotifications();
        notificationStore.addNotification('tx_submit', 'Transaction submitted to network');
        notificationStore.addNotification('tx_confirm', 'Transaction confirmed on ledger');
        const readNotif: AppNotification = {
          id: 'read-3',
          type: 'payout_success',
          message: 'Payout completed successfully',
          timestamp: Date.now() - 10800000,
          read: true,
        };
        notificationStore.setNotifications([readNotif, ...notificationStore.getSnapshot()]);
        break;
    }
  }, [scenario]);

  return (
    <main className="min-h-screen p-6 bg-[var(--background)]">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-4">NotificationsCenter Test Harness</h1>
        <div className="mb-6 flex gap-2 flex-wrap">
          <button
            onClick={() => setScenario('empty')}
            className={`px-3 py-1.5 rounded text-sm ${scenario === 'empty' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            Empty State
          </button>
          <button
            onClick={() => setScenario('with-notifications')}
            className={`px-3 py-1.5 rounded text-sm ${scenario === 'with-notifications' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            With Unread Notifications
          </button>
          <button
            onClick={() => setScenario('all-read')}
            className={`px-3 py-1.5 rounded text-sm ${scenario === 'all-read' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            All Read Notifications
          </button>
          <button
            onClick={() => setScenario('mixed')}
            className={`px-3 py-1.5 rounded text-sm ${scenario === 'mixed' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            Mixed Read/Unread
          </button>
        </div>
        <div className="flex justify-end">
          <NotificationsCenter />
        </div>
      </div>
    </main>
  );
}