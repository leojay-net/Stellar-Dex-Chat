'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { useNotifications, AppNotification } from '@/hooks/useNotifications';
import { useTheme } from '@/contexts/ThemeContext';

export default function NotificationsCenter() {
  // Track if component has mounted to prevent hydration mismatches
  const [isMounted, setIsMounted] = useState(false);
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

  const handleMarkAsRead = (id: string) => {
    markAsRead(id);
  };

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead();
  }, [markAllAsRead]);

  const handleClearNotifications = useCallback(() => {
    clearNotifications();
  }, [clearNotifications]);

  // Effect to mark component as mounted on client side only
  // This prevents hydration mismatches by ensuring all interactive state
  // is only used after the client has fully hydrated
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      dropdownRef.current &&
      !dropdownRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    // Only attach event listener after component has mounted on client
    if (!isMounted) return;

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMounted, handleClickOutside]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts when focus is inside an input/textarea
      const tag = (event.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (event.key === 'Escape') {
        setIsOpen(false);
        return;
      }
      if (!isOpen) return;
      if (event.key === 'm' || event.key === 'M') {
        handleMarkAllAsRead();
      } else if (event.key === 'd' || event.key === 'D') {
        handleClearNotifications();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleMarkAllAsRead, handleClearNotifications]);

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
        return 'text-[var(--color-primary)]';
      case 'tx_confirm':
        return 'text-[var(--color-success)]';
      case 'payout_pending':
        return 'text-[var(--color-warning)]';
      case 'payout_success':
        return 'text-[var(--color-success)]';
      case 'payout_fail':
        return 'text-[var(--color-danger)]';
      case 'risk_warning':
        return 'text-[var(--color-warning)]';
      default:
        return 'text-[var(--color-text-muted)]';
    }
  };

  // Only render interactive dropdown after client-side hydration completes
  // This prevents hydration mismatches caused by event listeners and state differences
  const handleToggleDropdown = useCallback(() => {
    if (isMounted) {
      setIsOpen((prev) => !prev);
    }
  }, [isMounted]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleDropdown}
        className={`relative p-2 rounded-lg transition-colors ${
          isDarkMode
            ? 'hover:bg-gray-800 text-gray-400'
            : 'hover:bg-gray-100 text-gray-600'
        }`}
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" />
        {isMounted && unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isMounted && isOpen && (
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
                    onClick={handleMarkAllAsRead}
                    title="Mark all as read"
                    className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleClearNotifications}
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
                      if (!notif.read) handleMarkAsRead(notif.id);
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
