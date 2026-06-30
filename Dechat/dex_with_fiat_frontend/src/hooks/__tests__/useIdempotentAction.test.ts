import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { useIdempotentAction } from '../useIdempotentAction';

describe('useIdempotentAction', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });

    return { promise, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute action successfully', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn().mockResolvedValue('success');

    let actionResult;
    await act(async () => {
      actionResult = await result.current.execute(mockAction, 'test_action');
    });

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(mockAction).toHaveBeenCalledWith(expect.stringContaining('test_action_'));
    expect(actionResult).toBe('success');
  });

  it('should prevent duplicate submissions during cooldown', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000 }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    let secondResult;
    await act(async () => {
      secondResult = await result.current.execute(mockAction, 'test_action');
    });

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(secondResult).toBeNull();
  });

  it('should allow execution after cooldown period', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 100 }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it("returns the first call's result for a second call with the same key", async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 0, logSuppressed: false }),
    );
    const pendingAction = deferred<string>();
    const mockAction = vi.fn(() => pendingAction.promise);

    let firstExecution!: Promise<string | null>;
    let secondExecution!: Promise<string | null>;
    act(() => {
      firstExecution = result.current.execute(mockAction, 'shared_key');
      secondExecution = result.current.execute(mockAction, 'shared_key');
    });

    await act(async () => {
      pendingAction.resolve('first-result');
      await expect(firstExecution).resolves.toBe('first-result');
      await expect(secondExecution).resolves.toBe('first-result');
    });

    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh action for a third call after the first completes', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 0, logSuppressed: false }),
    );
    const mockAction = vi
      .fn()
      .mockResolvedValueOnce('first-result')
      .mockResolvedValueOnce('fresh-result');

    let firstResult!: string | null;
    await act(async () => {
      firstResult = await result.current.execute(mockAction, 'shared_key');
    });

    let thirdResult!: string | null;
    await act(async () => {
      thirdResult = await result.current.execute(mockAction, 'shared_key');
    });

    expect(firstResult).toBe('first-result');
    expect(thirdResult).toBe('fresh-result');
    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it('does not let an error in the first call block a second call', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 0, logSuppressed: false }),
    );
    const firstError = new Error('first failed');
    const mockAction = vi
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce('recovered');

    await act(async () => {
      await expect(
        result.current.execute(mockAction, 'shared_key'),
      ).rejects.toThrow('first failed');
    });

    let secondResult!: string | null;
    await act(async () => {
      secondResult = await result.current.execute(mockAction, 'shared_key');
    });

    expect(secondResult).toBe('recovered');
    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it('should track isProcessing state correctly', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    let resolveAction: (value: string) => void = () => {};
    const mockAction = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAction = resolve;
        }),
    );

    expect(result.current.isProcessing).toBe(false);

    let executePromise: Promise<string | null>;
    act(() => {
      executePromise = result.current.execute(mockAction, 'test_action');
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    await act(async () => {
      resolveAction('success');
      await executePromise;
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });
  });

  it('should log suppressed duplicates when enabled', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000, logSuppressed: true }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[useIdempotentAction] Suppressed duplicate test_action attempt',
      expect.objectContaining({
        actionName: 'test_action',
        cooldownMs: 1000,
      }),
    );
  });

  it('should not log suppressed duplicates when disabled', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000, logSuppressed: false }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should generate unique idempotency keys', async () => {
    const { result } = renderHook(() => useIdempotentAction({ cooldownMs: 100 }));
    const capturedKeys: string[] = [];
    const mockAction = vi.fn((key: string) => {
      capturedKeys.push(key);
      return Promise.resolve('success');
    });

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
    expect(capturedKeys[0]).toMatch(/^test_action_\d+_[a-z0-9]+$/);
    expect(capturedKeys[1]).toMatch(/^test_action_\d+_[a-z0-9]+$/);
  });

  it('should reset state correctly', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000 }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    let blockedResult: string | null = 'not-null';
    await act(async () => {
      blockedResult = await result.current.execute(mockAction, 'test_action');
    });
    expect(blockedResult).toBeNull();
    expect(mockAction).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reset();
    });

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(mockAction).toHaveBeenCalledTimes(2);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should handle action errors gracefully', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn().mockRejectedValue(new Error('Action failed'));

    await act(async () => {
      try {
        await result.current.execute(mockAction, 'test_action');
      } catch (error) {
        expect(error).toEqual(new Error('Action failed'));
      }
    });

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should prevent rapid-click scenarios', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 500 }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    let results!: Array<string | null>;
    await act(async () => {
      results = await Promise.all([
        result.current.execute(mockAction, 'button_click'),
        result.current.execute(mockAction, 'button_click'),
        result.current.execute(mockAction, 'button_click'),
        result.current.execute(mockAction, 'button_click'),
        result.current.execute(mockAction, 'button_click'),
      ]);
    });

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      'success',
      'success',
      'success',
      'success',
      'success',
    ]);
  });

  it('should dedupe submissions while processing', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    let resolveAction: (value: string) => void = () => {};
    const mockAction = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAction = resolve;
        }),
    );

    let firstExecution: Promise<string | null>;
    act(() => {
      firstExecution = result.current.execute(mockAction, 'test_action');
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    let secondExecution!: Promise<string | null>;
    await act(async () => {
      secondExecution = result.current.execute(mockAction, 'test_action');
    });

    await act(async () => {
      resolveAction('success');
      await firstExecution;
    });

    await expect(secondExecution).resolves.toBe('success');
    expect(mockAction).toHaveBeenCalledTimes(1);
  });
});
