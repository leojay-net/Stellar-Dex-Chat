import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdempotentAction } from '../useIdempotentAction';

describe('useIdempotentAction', () => {
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
    expect(mockAction).toHaveBeenCalledWith(
      expect.stringContaining('test_action_'),
    );
    expect(actionResult).toBe('success');
  });

  it('should prevent duplicate submissions during cooldown', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000 }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    // First execution
    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    // Second execution (should be suppressed)
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

    // First execution
    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Second execution (should succeed)
    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it('should track isProcessing state correctly', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve('success'), 100)),
    );

    expect(result.current.isProcessing).toBe(false);

    let executePromise: Promise<unknown>;
    await act(async () => {
      executePromise = result.current.execute(mockAction, 'test_action');
    });

    // Should be processing during execution
    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    await act(async () => {
      await executePromise;
    });

    // Should not be processing after completion
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
      expect.stringContaining('Suppressed duplicate test_action attempt'),
      expect.objectContaining({
        actionName: 'test_action',
        cooldownMs: 1000,
      }),
    );
  });

  it('should reset state correctly', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    // We check isProcessing instead of lastExecutionTime since it's a ref and might not be reflected in state immediately without transition
    await act(async () => {
      result.current.reset();
    });

    expect(result.current.isProcessing).toBe(false);
    // lastExecutionTime should be reset in the ref
    expect(result.current.state.lastExecutionTime).toBe(0);
  });

  it('should handle action errors gracefully', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn().mockRejectedValue(new Error('Action failed'));

    await expect(
      act(async () => {
        await result.current.execute(mockAction, 'test_action');
      })
    ).rejects.toThrow('Action failed');

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should prevent rapid-click scenarios', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 500 }),
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    // Simulate rapid clicks
    await act(async () => {
      const clicks = Array.from({ length: 5 }, () =>
        result.current.execute(mockAction, 'button_click'),
      );
      await Promise.all(clicks);
    });

    // Only the first click should execute
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('should block submissions while processing', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve('success'), 200)),
    );

    // Start first execution
    let firstExecution: Promise<unknown>;
    await act(async () => {
      firstExecution = result.current.execute(mockAction, 'test_action');
    });

    // Try to execute again while first is still processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    let secondResult;
    await act(async () => {
      secondResult = await result.current.execute(mockAction, 'test_action');
    });

    await act(async () => {
      await firstExecution;
    });

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(secondResult).toBeNull();
  });
});
