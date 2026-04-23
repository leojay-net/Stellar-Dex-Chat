'use client';

import { useState, useEffect, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { toastStore, AppToast, ToastVariant } from '@/lib/toastStore';
import { useTheme } from '@/contexts/ThemeContext';

interface ToastItemProps {
  toast: AppToast;
  onDismiss: (id: string) => void;
  isDarkMode: boolean;
}

function ToastItem({ toast, onDismiss, isDarkMode }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 5000);

    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const getVariantStyles = (variant: ToastVariant) => {
    const baseClasses = `flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg transition-all`;
    
    switch (variant) {
      case 'success':
        return `${baseClasses} ${isDarkMode ? 'bg-green-900 border border-green-700' : 'bg-green-100 border border-green-300'} ${isDarkMode ? 'text-green-100' : 'text-green-800'}`;
      case 'error':
        return `${baseClasses} ${isDarkMode ? 'bg-red-900 border border-red-700' : 'bg-red-100 border border-red-300'} ${isDarkMode ? 'text-red-100' : 'text-red-800'}`;
      case 'warning':
        return `${baseClasses} ${isDarkMode ? 'bg-yellow-900 border border-yellow-700' : 'bg-yellow-100 border border-yellow-300'} ${isDarkMode ? 'text-yellow-100' : 'text-yellow-800'}`;
      case 'info':
      default:
        return `${baseClasses} ${isDarkMode ? 'bg-blue-900 border border-blue-700' : 'bg-blue-100 border border-blue-300'} ${isDarkMode ? 'text-blue-100' : 'text-blue-800'}`;
    }
  };

  const getIconComponent = (variant: ToastVariant) => {
    const iconClasses = 'w-5 h-5 flex-shrink-0 mt-0.5';
    switch (variant) {
      case 'success':
        return <CheckCircle className={iconClasses} />;
      case 'error':
        return <AlertCircle className={iconClasses} />;
      case 'warning':
        return <AlertTriangle className={iconClasses} />;
      case 'info':
      default:
        return <Info className={iconClasses} />;
    }
  };

  return (
    <div className={getVariantStyles(toast.variant)}>
      {getIconComponent(toast.variant)}
      <div className="flex-1">
        <p className="font-medium text-sm">{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 ml-2 hover:opacity-70 transition-opacity"
        aria-label="Dismiss toast"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const { isDarkMode } = useTheme();

  useEffect(() => {
    const unsubscribe = toastStore.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });

    return () => unsubscribe();
  }, []);

  const handleDismiss = (id: string) => {
    toastStore.dismissToast(id);
  };

  return (
    <>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={handleDismiss}
            isDarkMode={isDarkMode}
          />
        ))}
      </div>
    </>
  );
}
