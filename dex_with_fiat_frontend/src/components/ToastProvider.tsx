'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { ReactNode } from 'react';
import { useToast } from '@/hooks/useToast';
import { AppToast } from '@/lib/toastStore';
import { useTheme } from '@/contexts/ThemeContext';

interface ToastProviderProps {
  children: ReactNode;
}

function getToastClasses(isDarkMode: boolean, toast: AppToast) {
  if (isDarkMode) {
    switch (toast.severity) {
      case 'success':
        return 'border-green-500/50 bg-green-900/30 text-green-100';
      case 'warning':
        return 'border-amber-500/50 bg-amber-900/30 text-amber-100';
      case 'error':
        return 'border-red-500/50 bg-red-900/30 text-red-100';
      default:
        return 'border-blue-500/50 bg-blue-900/30 text-blue-100';
    }
  }

  switch (toast.severity) {
    case 'success':
      return 'border-green-200 bg-green-50 text-green-900';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-900';
    default:
      return 'border-blue-200 bg-blue-50 text-blue-900';
  }
}

function ToastIcon({ severity }: { severity: AppToast['severity'] }) {
  switch (severity) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
    case 'error':
      return <XCircle className="h-4 w-4" aria-hidden="true" />;
    default:
      return <Info className="h-4 w-4" aria-hidden="true" />;
  }
}

export function ToastProvider({ children }: ToastProviderProps) {
  const { toasts, dismissToast } = useToast();
  const { isDarkMode } = useTheme();

  return (
    <>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,24rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm transition-all ${getToastClasses(
              isDarkMode,
              toast,
            )}`}
          >
            <div className="mt-0.5 flex-shrink-0">
              <ToastIcon severity={toast.severity} />
            </div>

            <p className="flex-1 text-sm font-medium leading-5">
              {toast.message}
            </p>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="rounded p-1 opacity-80 transition-opacity hover:opacity-100"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
