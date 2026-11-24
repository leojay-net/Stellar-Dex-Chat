'use client';

import { useState } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';

/** Child that crashes on demand */
function BombChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Deliberate test crash');
  }
  return (
    <p data-testid="child-content" className="text-sm text-green-700">
      Child rendered successfully.
    </p>
  );
}

/**
 * Test harness page for ErrorBoundary E2E tests.
 *
 * A "Throw Error" button triggers a crash inside ErrorBoundary so tests can
 * verify the fallback UI, retry/reload behaviour, and keyboard shortcuts.
 *
 * A "Reset" button resets the local `shouldThrow` flag so tests can check the
 * `onRetry` path without reloading the page.
 */
export default function TestErrorBoundaryPage() {
  const [shouldThrow, setShouldThrow] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const handleRetry = () => {
    setShouldThrow(false);
    setRetryCount((c) => c + 1);
  };

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">ErrorBoundary Test Harness</h1>

      <div className="flex gap-3">
        <button
          type="button"
          data-testid="trigger-error"
          onClick={() => setShouldThrow(true)}
          className="px-3 py-1 text-sm rounded border bg-red-50 border-red-300"
        >
          Throw Error
        </button>
        <button
          type="button"
          data-testid="reset-error"
          onClick={() => setShouldThrow(false)}
          className="px-3 py-1 text-sm rounded border"
        >
          Reset
        </button>
      </div>

      {retryCount > 0 && (
        <p data-testid="retry-count" className="text-sm text-blue-700">
          Retry triggered {retryCount} time{retryCount === 1 ? '' : 's'}.
        </p>
      )}

      <ErrorBoundary
        onRetry={handleRetry}
        retryLabel="Try Again"
        title="Something went wrong."
        message="Please refresh the page."
      >
        <BombChild shouldThrow={shouldThrow} />
      </ErrorBoundary>
    </main>
  );
}
