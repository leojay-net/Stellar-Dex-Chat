import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import OfflineStatusBanner, {
  BANNER_SCROLL_MARGIN_PX,
} from './OfflineStatusBanner';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(() => ({
    isOnline: true,
    wasOffline: false,
    resetWasOffline: vi.fn(),
  })),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn() })),
}));

vi.mock('@/lib/offlineStatusSchema', () => ({
  offlineStatusToastSchema: {
    safeParse: vi.fn(() => ({ success: true, data: {} })),
  },
}));

vi.mock('@/lib/offlineMessageQueue', () => ({
  subscribeToQueuedMessageCount: vi.fn(() => () => {}),
}));

const mockedUseOnlineStatus = vi.mocked(useOnlineStatus);

const BANNER_HEIGHT = 48;

function stubOnlineStatus(getIsOnline: () => boolean) {
  mockedUseOnlineStatus.mockImplementation(() => ({
    get isOnline() {
      return getIsOnline();
    },
    wasOffline: false,
    resetWasOffline: vi.fn(),
  }));
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubLayout(focusedTop: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.testid === 'offline-status-banner')
        return rect(0, BANNER_HEIGHT);
      if (this.dataset.testid === 'focus-target') return rect(focusedTop, 32);
      return rect(0, 0);
    },
  );
}

function focusTarget() {
  const input = document.createElement('input');
  input.dataset.testid = 'focus-target';
  document.body.appendChild(input);
  input.focus();
  return input;
}

function mockReducedMotion(reduce: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('OfflineStatusBanner - auto-scroll', () => {
  let scrollBy: ReturnType<typeof vi.fn>;
  let target: HTMLInputElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    scrollBy = vi.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    mockReducedMotion(false);
    document.documentElement.style.scrollPaddingTop = '';
  });

  afterEach(() => {
    target?.remove();
    target = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.documentElement.style.scrollPaddingTop = '';
  });

  it('reserves the banner height as scroll-padding-top while visible', () => {
    stubLayout(200);
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(screen.getByTestId('offline-status-banner')).toBeInTheDocument();
    expect(document.documentElement.style.scrollPaddingTop).toBe(
      `${BANNER_HEIGHT}px`,
    );
  });

  it('restores the previous scroll-padding-top once the banner hides', () => {
    document.documentElement.style.scrollPaddingTop = '12px';
    stubLayout(200);
    let isOnline = false;
    stubOnlineStatus(() => isOnline);

    const { rerender } = render(<OfflineStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(document.documentElement.style.scrollPaddingTop).toBe(
      `${BANNER_HEIGHT}px`,
    );

    isOnline = true;
    rerender(<OfflineStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(
      screen.queryByTestId('offline-status-banner'),
    ).not.toBeInTheDocument();
    expect(document.documentElement.style.scrollPaddingTop).toBe('12px');
  });

  it('restores scroll-padding-top on unmount', () => {
    stubLayout(200);
    stubOnlineStatus(() => false);

    const { unmount } = render(<OfflineStatusBanner />);
    unmount();

    expect(document.documentElement.style.scrollPaddingTop).toBe('');
  });

  it('scrolls a focused element out from under the banner', () => {
    target = focusTarget();
    stubLayout(10);
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({
      top: 10 - BANNER_HEIGHT - BANNER_SCROLL_MARGIN_PX,
      behavior: 'smooth',
    });
  });

  it('scrolls instantly when the user prefers reduced motion', () => {
    mockReducedMotion(true);
    target = focusTarget();
    stubLayout(10);
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });

  it('does not scroll when the focused element is already clear of the banner', () => {
    target = focusTarget();
    stubLayout(BANNER_HEIGHT + 20);
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not scroll back to a focused element the user scrolled away from', () => {
    target = focusTarget();
    stubLayout(-200);
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not scroll when nothing is focused', () => {
    stubLayout(10);
    stubOnlineStatus(() => false);

    render(<OfflineStatusBanner />);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not touch scroll state while online with no banner', () => {
    stubLayout(10);
    stubOnlineStatus(() => true);

    render(<OfflineStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(
      screen.queryByTestId('offline-status-banner'),
    ).not.toBeInTheDocument();
    expect(document.documentElement.style.scrollPaddingTop).toBe('');
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
