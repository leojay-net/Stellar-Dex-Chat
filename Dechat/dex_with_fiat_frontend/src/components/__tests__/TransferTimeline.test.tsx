import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TransferTimeline from '@/components/TransferTimeline';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

describe('TransferTimeline - skeleton loading state', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders skeleton when isLoading is true', () => {
    render(<TransferTimeline events={[]} isLoading={true} />);

    expect(screen.getByTestId('skeleton-timeline')).toBeTruthy();
  });

  it('does not render skeleton when isLoading is false with events', () => {
    render(
      <TransferTimeline
        events={[{ status: 'initiated', timestamp: new Date() }]}
        isLoading={false}
      />
    );

    expect(screen.queryByTestId('skeleton-timeline')).toBeNull();
  });

  it('does not render skeleton when isLoading is false with no events', () => {
    render(<TransferTimeline events={[]} isLoading={false} />);

    expect(screen.queryByTestId('skeleton-timeline')).toBeNull();
    expect(screen.getByText('No status events yet.')).toBeTruthy();
  });

  it('renders skeleton instead of empty state when loading', () => {
    render(<TransferTimeline events={[]} isLoading={true} />);

    expect(screen.getByTestId('skeleton-timeline')).toBeTruthy();
    expect(screen.queryByText('No status events yet.')).toBeNull();
  });

  it('renders skeleton instead of events when loading with events', () => {
    render(
      <TransferTimeline
        events={[
          { status: 'initiated', timestamp: new Date() },
          { status: 'pending', timestamp: new Date() },
        ]}
        isLoading={true}
      />
    );

    expect(screen.getByTestId('skeleton-timeline')).toBeTruthy();
    expect(screen.queryByText('Transfer initiated')).toBeNull();
  });

  it('renders events normally when not loading', () => {
    render(
      <TransferTimeline
        events={[{ status: 'success', timestamp: new Date() }]}
        isLoading={false}
      />
    );

    expect(screen.queryByTestId('skeleton-timeline')).toBeNull();
    expect(screen.getByText('Transfer successful')).toBeTruthy();
  });
});
