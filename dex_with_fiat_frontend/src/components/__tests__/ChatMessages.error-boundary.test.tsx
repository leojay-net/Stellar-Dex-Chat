import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

function ThrowingChatMessages() {
  throw new Error('ChatMessages crashed');
}

describe('ChatMessages error boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the chat fallback when ChatMessages throws', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(
      <ErrorBoundary
        title="Chat unavailable. Please refresh."
        retryLabel="Retry"
      >
        <ThrowingChatMessages />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Chat unavailable. Please refresh.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
