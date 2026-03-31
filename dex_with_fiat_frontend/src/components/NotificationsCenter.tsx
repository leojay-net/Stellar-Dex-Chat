'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { useNotifications, AppNotification } from '@/hooks/useNotifications';
import { useTheme } from '@/contexts/ThemeContext';

export default function NotificationsCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
  } = useNotifications();
  const { isDarkMode } = useTheme();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatTime = (ts: number) => {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const diff = (ts - Date.now()) / 1000;

    if (Math.abs(diff) < 60) return 'Just now';
    if (Math.abs(diff) < 3600)
      return rtf.format(Math.round(diff / 60), 'minute');
    if (Math.abs(diff) < 86400)
      return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  };

  const getIconColor = (type: AppNotification['type']) => {
    switch (type) {
      case 'tx_submit':
        return 'text-blue-500';
      case 'tx_confirm':
        return 'text-green-500';
      case 'payout_pending':
        return 'text-yellow-500';
      case 'payout_success':
        return 'text-green-500';
      case 'payout_fail':
        return 'text-red-500';
      case 'risk_warning':
        return 'text-amber-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-lg transition-colors ${
          isDarkMode
            ? 'hover:bg-gray-800 text-gray-400'
            : 'hover:bg-gray-100 text-gray-600'
        }`}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-80 sm:w-96 rounded-xl shadow-xl border z-50 overflow-hidden ${
            isDarkMode
              ? 'bg-gray-900 border-gray-800'
              : 'bg-white border-gray-200'
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 py-3 border-b ${
              isDarkMode ? 'border-gray-800' : 'border-gray-100'
            }`}
          >
            <h3
              className={`font-semibold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
            >
              Notifications
            </h3>
            <div className="flex gap-2">
              {notifications.length > 0 && (
                <>
                  <button
                    onClick={markAllAsRead}
                    title="Mark all as read"
                    className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={clearNotifications}
                    title="Clear all"
                    className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div
                className={`px-4 py-8 text-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}
              >
                No notifications yet
              </div>
            ) : (
              <div
                className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}
              >
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer flex gap-3 ${
                      !notif.read
                        ? isDarkMode
                          ? 'bg-blue-900/10'
                          : 'bg-blue-50/50'
                        : ''
                    }`}
                    onClick={() => {
                      if (!notif.read) markAsRead(notif.id);
                    }}
                  >
                    <div className="mt-1 flex-shrink-0">
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 ${!notif.read ? getIconColor(notif.type) : 'bg-transparent'}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'} ${!notif.read ? 'font-medium' : ''}`}
                      >
                        {notif.message}
                      </p>
                      <p
                        className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                      >
                        {formatTime(notif.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
