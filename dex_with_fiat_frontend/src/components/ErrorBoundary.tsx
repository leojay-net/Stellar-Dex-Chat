'use client';

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  isDarkMode?: boolean;
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Chat UI crashed:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
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
              onClick={() => {
                if (this.props.onRetry) {
                  this.setState({ hasError: false });
                  this.props.onRetry();
                  return;
                }
                window.location.reload();
              }}
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {this.props.retryLabel ?? 'Reload'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
