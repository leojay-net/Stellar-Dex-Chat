'use client';

import React from 'react';
import { UserPreferencesContext } from '@/contexts/UserPreferencesContext';
import { isEditableShortcutTarget } from '@/lib/keyboardShortcuts';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  isDarkMode?: boolean;
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

type WindowWithSentry = Window & {
  Sentry?: {
    captureException(
      error: Error,
      ctx: { extra: Record<string, unknown> },
    ): void;
  };
};

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  static contextType = UserPreferencesContext;
  declare context: React.ContextType<typeof UserPreferencesContext>;

  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  // #1184: "r" / "Enter" retries the same way the button's onClick does,
  // for keyboard users who'd rather not reach for the mouse after a crash.
  // Only acts while the fallback is actually showing, and ignores the
  // shortcut while focus is in a form field so it can't hijack typing.
  private handleKeyDown = (event: KeyboardEvent) => {
    if (!this.state.hasError) {
      return;
    }
    if (isEditableShortcutTarget(event.target)) return;
    const retryKey =
      this.context?.singleKeyShortcutsEnabled !== false &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.toLowerCase() === 'r';
    if (event.key === 'Enter' || retryKey) {
      event.preventDefault();
      this.retry();
    }
  };

  private retry = () => {
    if (this.props.onRetry) {
      this.setState({ hasError: false });
      this.props.onRetry();
      return;
    }
    window.location.reload();
  };

  public componentDidMount() {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  public componentWillUnmount() {
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Chat UI crashed:', error, errorInfo);

    // Report to Sentry-compatible SDK if available on the page
    const win = window as WindowWithSentry;
    if (typeof win.Sentry?.captureException === 'function') {
      win.Sentry.captureException(error, {
        extra: { componentStack: errorInfo.componentStack ?? '' },
      });
    }

    // Dispatch a custom event so other monitoring listeners can react
    window.dispatchEvent(
      new CustomEvent('app:error', {
        detail: { error, componentStack: errorInfo.componentStack },
        bubbles: true,
      }),
    );

    this.props.onError?.(error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      const isDarkMode = this.props.isDarkMode ?? true;

      return (
        <div
          className={`flex h-full w-full items-center justify-center px-6 ${
            isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'
          }`}
        >
          <div
            className={`w-full max-w-md rounded-2xl border p-6 text-center shadow-lg ${
              isDarkMode
                ? 'border-gray-700 bg-gray-800'
                : 'border-gray-200 bg-white'
            }`}
          >
            <h1 className="text-xl font-semibold">
              {this.props.title ?? 'Something went wrong.'}
            </h1>
            <p
              className={`mt-2 text-sm ${
                isDarkMode ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {this.props.message ?? 'Please refresh the page.'}
            </p>
            <button
              type="button"
              onClick={this.retry}
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {this.props.retryLabel ?? 'Reload'}
            </button>
            <p
              className={`mt-3 text-xs ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Press{' '}
              <kbd
                className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                  isDarkMode
                    ? 'border-gray-600 bg-gray-700 text-gray-200'
                    : 'border-gray-300 bg-gray-100 text-gray-700'
                }`}
              >
                Enter
              </kbd>{' '}
              or{' '}
              <kbd
                className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                  isDarkMode
                    ? 'border-gray-600 bg-gray-700 text-gray-200'
                    : 'border-gray-300 bg-gray-100 text-gray-700'
                }`}
              >
                R
              </kbd>{' '}
              to retry
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
