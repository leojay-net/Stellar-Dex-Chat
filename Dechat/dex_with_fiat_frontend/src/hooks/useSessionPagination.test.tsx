import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionPagination } from './useSessionPagination';

type SessionPaginationTelemetryDetail = {
  event: string;
  pageSize?: number;
  totalItems?: number;
  visibleCount?: number;
  previousVisibleCount?: number;
  nextVisibleCount?: number;
};

function capturePaginationTelemetry(): Promise<SessionPaginationTelemetryDetail> {
  return new Promise((resolve) => {
    window.addEventListener(
      'session_pagination_telemetry',
      (event) =>
        resolve(
          (event as CustomEvent<SessionPaginationTelemetryDetail>).detail,
        ),
      { once: true },
    );
  });
}

describe('useSessionPagination telemetry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('dispatches initialization telemetry on mount', async () => {
    const eventPromise = capturePaginationTelemetry();
    renderHook(() => useSessionPagination(['one', 'two', 'three'], 2));

    await expect(eventPromise).resolves.toMatchObject({
      event: 'session_pagination_initialized',
      pageSize: 2,
      totalItems: 3,
    });
  });

  it('dispatches load-more telemetry after user requests more items', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useSessionPagination(['one', 'two', 'three'], 1),
    );
    const eventPromise = capturePaginationTelemetry();

    act(() => {
      result.current.loadMore();
    });

    await vi.advanceTimersByTimeAsync(300);
    await expect(eventPromise).resolves.toMatchObject({
      event: 'session_pagination_loaded_more',
      pageSize: 1,
      previousVisibleCount: 1,
      nextVisibleCount: 2,
      totalItems: 3,
    });
  });
});
