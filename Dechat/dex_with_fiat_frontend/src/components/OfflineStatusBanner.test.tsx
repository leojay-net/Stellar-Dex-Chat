import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import OfflineStatusBanner from './OfflineStatusBanner';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { subscribeToQueuedMessageCount } from '@/lib/offlineMessageQueue';

// Mock dependencies
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(() => ({
    isOnline: true,
    wasOffline: false,
    resetWasOffline: vi.fn(),
  })),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: vi.fn(() => ({
    addToast: vi.fn(),
  })),
}));

vi.mock('@/lib/offlineStatusSchema', () => ({
  offlineStatusToastSchema: {
    safeParse: vi.fn(() => ({ success: true, data: {} })),
  },
}));

vi.mock('@/lib/offlineMessageQueue', () => ({
  subscribeToQueuedMessageCount: vi.fn(() => () => {}),
  setQueuedMessageCount: vi.fn(),
  getQueuedMessageCount: vi.fn(() => 0),
}));

const mockedUseOnlineStatus = vi.mocked(useOnlineStatus);
const mockedSubscribe = vi.mocked(subscribeToQueuedMessageCount);

/** Elapse the 300ms initial loading gate so it cannot mask later renders. */
function settleLoadingGate() {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

/** Point `useOnlineStatus` at a value the test can flip between renders. */
function stubOnlineStatus(getIsOnline: () => boolean, wasOffline = false) {
  const resetWasOffline = vi.fn();
  mockedUseOnlineStatus.mockImplementation(() => ({
    get isOnline() {
      return getIsOnline();
    },
    wasOffline,
    resetWasOffline,
  }));
  return resetWasOffline;
}

describe('OfflineStatusBanner - Optimistic UI Updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSubscribe.mockImplementation(() => () => {});
    // Fake timers are required for the 300ms loading skeleton and the 500ms
    // reconnect dismissal. Assertions below are made directly after an explicit
    // `advanceTimersByTime` rather than through `waitFor`, whose polling never
    // fires while the clock is frozen.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should show banner immediately when going offline', () => {
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/You are offline/i)).toBeInTheDocument();
  });

  it('should show reconnecting state when coming back online', () => {
    let isOnline = false;
    stubOnlineStatus(() => isOnline, true);

    const { rerender } = render(<OfflineStatusBanner />);
    settleLoadingGate();
    expect(screen.getByText(/You are offline/i)).toBeInTheDocument();

    // Simulate coming back online
    isOnline = true;
    rerender(<OfflineStatusBanner />);

    expect(screen.getByText(/Reconnecting/i)).toBeInTheDocument();
  });

  it('should display optimistic pending count', () => {
    stubOnlineStatus(() => false);
    // The count is pushed by `offlineMessageQueue` subscribers, not pulled.
    mockedSubscribe.mockImplementation((listener) => {
      listener(3);
      return () => {};
    });

    render(<OfflineStatusBanner />);

    expect(screen.getByText(/3 messages waiting to send/i)).toBeInTheDocument();
  });

  it('should pluralise a single pending message', () => {
    stubOnlineStatus(() => false);
    mockedSubscribe.mockImplementation((listener) => {
      listener(1);
      return () => {};
    });

    render(<OfflineStatusBanner />);

    expect(screen.getByText(/1 message waiting to send/i)).toBeInTheDocument();
  });

  it('should hide banner after reconnection delay', () => {
    let isOnline = false;
    const resetWasOffline = stubOnlineStatus(() => isOnline, true);

    const { rerender } = render(<OfflineStatusBanner />);
    settleLoadingGate();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Simulate coming back online
    isOnline = true;
    rerender(<OfflineStatusBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(resetWasOffline).toHaveBeenCalled();
  });

  it('should update aria-label based on connection state', () => {
    let isOnline = false;
    stubOnlineStatus(() => isOnline, true);

    const { rerender } = render(<OfflineStatusBanner />);
    settleLoadingGate();
    expect(screen.getByLabelText('Offline status')).toBeInTheDocument();

    isOnline = true;
    rerender(<OfflineStatusBanner />);

    expect(screen.getByLabelText('Reconnecting')).toBeInTheDocument();
  });

  it('should show loading skeleton initially when online', () => {
    stubOnlineStatus(() => true);

    render(<OfflineStatusBanner />);

    // Should show loading skeleton initially
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(
      document.querySelector('[aria-hidden="true"]'),
    ).not.toBeInTheDocument();
  });
});
