import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

function ThrowingPriceTicker() {
  throw new Error('PriceTicker crashed');
}

describe('PriceTicker error boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the compact fallback instead of crashing the sidebar when PriceTicker throws', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(
      <ErrorBoundary
        fallback={
          <div>
            <p>Prices unavailable</p>
          </div>
        }
      >
        <ThrowingPriceTicker />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Prices unavailable')).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
