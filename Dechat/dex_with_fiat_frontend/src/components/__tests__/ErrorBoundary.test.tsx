import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('kaboom');
}

describe('ErrorBoundary keyboard shortcuts (#1184)', () => {
  it('retries via the "R" key', () => {
    const onRetry = vi.fn();
    render(
      <ErrorBoundary onRetry={onRetry}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'r' });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retries via the Enter key', () => {
    const onRetry = vi.fn();
    render(
      <ErrorBoundary onRetry={onRetry}>
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('reloads the page via keyboard when no onRetry is provided', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.keyDown(window, { key: 'r' });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores the shortcut while no error is present', () => {
    const onRetry = vi.fn();
    render(
      <ErrorBoundary onRetry={onRetry}>
        <div>fine</div>
      </ErrorBoundary>,
    );

    fireEvent.keyDown(window, { key: 'r' });

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('shows a keyboard hint alongside the retry button', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Enter')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });
});
