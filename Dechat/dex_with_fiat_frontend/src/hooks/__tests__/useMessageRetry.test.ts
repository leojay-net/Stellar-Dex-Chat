import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AUTO_RETRIES,
  RETRY_BASE_DELAY_MS,
  getRetryDelayMs,
  useMessageRetry,
} from '@/hooks/useMessageRetry';

describe('getRetryDelayMs', () => {
  it('doubles on each attempt', () => {
    expect(getRetryDelayMs(1)).toBe(RETRY_BASE_DELAY_MS);
    expect(getRetryDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(getRetryDelayMs(3)).toBe(RETRY_BASE_DELAY_MS * 4);
  });

  it('clamps non-positive attempts to the base delay', () => {
    expect(getRetryDelayMs(0)).toBe(RETRY_BASE_DELAY_MS);
    expect(getRetryDelayMs(-5)).toBe(RETRY_BASE_DELAY_MS);
  });
});

describe('useMessageRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /**
   * Advance `ms` in 250ms slices, each with its own `act` boundary. React's
   * scheduler flushes on a MessageChannel task that a single long
   * `advanceTimersByTimeAsync` never yields to, so one big jump would leave the
   * effect that schedules the *next* backoff step unrun.
   */
  const advanceInSlices = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      await advance(250);
    }
  };

  it('makes at most MAX_AUTO_RETRIES automatic attempts, with exponential backoff', async () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'send me again',
        isFailed: true,
        onRetry,
      }),
    );

    expect(onRetry).not.toHaveBeenCalled();

    // Attempt 1 after 1s.
    await advance(RETRY_BASE_DELAY_MS - 1);
    expect(onRetry).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Attempt 2 after a further 2s.
    await advance(RETRY_BASE_DELAY_MS * 2 - 1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(onRetry).toHaveBeenCalledTimes(2);

    // Attempt 3 after a further 4s.
    await advance(RETRY_BASE_DELAY_MS * 4);
    expect(onRetry).toHaveBeenCalledTimes(MAX_AUTO_RETRIES);

    // Budget spent — no further automatic attempts, ever.
    await advanceInSlices(30_000);
    expect(onRetry).toHaveBeenCalledTimes(MAX_AUTO_RETRIES);
    expect(result.current.attempts).toBe(MAX_AUTO_RETRIES);
    expect(result.current.hasExhaustedAutoRetries).toBe(true);
    expect(result.current.secondsUntilNextRetry).toBeNull();
  });

  it('resends the original content, not a rewritten body', async () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'the original text',
        isFailed: true,
        onRetry,
      }),
    );

    await advance(RETRY_BASE_DELAY_MS);
    expect(onRetry).toHaveBeenCalledWith('m1', 'the original text');
  });

  it('does not retry while the message is not failed', async () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'hi',
        isFailed: false,
        onRetry,
      }),
    );

    await advanceInSlices(10_000);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does nothing without a handler', async () => {
    const { result } = renderHook(() =>
      useMessageRetry({ messageId: 'm1', content: 'hi', isFailed: true }),
    );

    await advanceInSlices(10_000);
    expect(result.current.attempts).toBe(0);
    expect(result.current.isRetrying).toBe(false);
  });

  it('exposes a countdown to the next automatic attempt', async () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'hi',
        isFailed: true,
        onRetry,
      }),
    );

    await advance(0);
    expect(result.current.secondsUntilNextRetry).toBe(1);

    await advance(500);
    expect(result.current.secondsUntilNextRetry).toBe(1);
  });

  it('retries immediately on demand without spending the automatic budget', async () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'hi',
        isFailed: true,
        onRetry,
      }),
    );

    act(() => result.current.retryNow());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result.current.attempts).toBe(0);

    // The three automatic attempts still follow.
    await advanceInSlices(30_000);
    expect(onRetry).toHaveBeenCalledTimes(1 + MAX_AUTO_RETRIES);
  });

  it('reports in-flight state and recovers when an async resend rejects', async () => {
    let reject: (reason: Error) => void = () => {};
    const onRetry = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectFn) => {
          reject = rejectFn;
        }),
    );

    const { result } = renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'hi',
        isFailed: true,
        onRetry,
      }),
    );

    act(() => result.current.retryNow());
    expect(result.current.isRetrying).toBe(true);

    await act(async () => {
      reject(new Error('still offline'));
      await Promise.resolve();
    });
    expect(result.current.isRetrying).toBe(false);

    // Failure did not stall the schedule.
    await advance(RETRY_BASE_DELAY_MS);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not stall when the handler throws synchronously', async () => {
    const onRetry = vi.fn(() => {
      throw new Error('boom');
    });

    const { result } = renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'hi',
        isFailed: true,
        onRetry,
      }),
    );

    expect(() => act(() => result.current.retryNow())).not.toThrow();
    expect(result.current.isRetrying).toBe(false);
  });

  it('resets the budget once the message stops being failed', async () => {
    const onRetry = vi.fn();
    const { result, rerender } = renderHook(
      ({ isFailed }: { isFailed: boolean }) =>
        useMessageRetry({
          messageId: 'm1',
          content: 'hi',
          isFailed,
          onRetry,
        }),
      { initialProps: { isFailed: true } },
    );

    await advanceInSlices(30_000);
    expect(result.current.attempts).toBe(MAX_AUTO_RETRIES);

    rerender({ isFailed: false });
    expect(result.current.attempts).toBe(0);
    expect(result.current.hasExhaustedAutoRetries).toBe(false);

    // A later failure of the same message gets a fresh set of attempts.
    onRetry.mockClear();
    rerender({ isFailed: true });
    await advanceInSlices(30_000);
    expect(onRetry).toHaveBeenCalledTimes(MAX_AUTO_RETRIES);
  });

  it('cancels pending retries on unmount', async () => {
    const onRetry = vi.fn();
    const { unmount } = renderHook(() =>
      useMessageRetry({
        messageId: 'm1',
        content: 'hi',
        isFailed: true,
        onRetry,
      }),
    );

    unmount();
    await advanceInSlices(10_000);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
