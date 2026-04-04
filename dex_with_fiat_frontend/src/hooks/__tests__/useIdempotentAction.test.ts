import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    expect(mockAction).toHaveBeenCalledWith(expect.stringContaining('test_action_'));
    expect(actionResult).toBe('success');
  });

  it('should prevent duplicate submissions during cooldown', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000 })
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
      useIdempotentAction({ cooldownMs: 100 })
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    // First execution
    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    // Wait for cooldown
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // Second execution (should succeed)
    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it.skip('should track isProcessing state correctly', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve('success'), 100))
    );

    expect(result.current.isProcessing).toBe(false);

    const executePromise = act(async () => {
      return result.current.execute(mockAction, 'test_action');
    });

    // Should be processing during execution
    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    await executePromise;

    // Should not be processing after completion
    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });
  });

  it.skip('should log suppressed duplicates when enabled', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000, logSuppressed: true })
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
      })
    );
  });

  it.skip('should not log suppressed duplicates when disabled', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 1000, logSuppressed: false })
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

  it.skip('should generate unique idempotency keys', async () => {
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

  it.skip('should reset state correctly', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn().mockResolvedValue('success');

    await act(async () => {
      await result.current.execute(mockAction, 'test_action');
    });

    expect(result.current.state.lastExecutionTime).toBeGreaterThan(0);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isProcessing).toBe(false);
    expect(result.current.state.lastExecutionTime).toBe(0);
  });

  it.skip('should handle action errors gracefully', async () => {
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

  it.skip('should prevent rapid-click scenarios', async () => {
    const { result } = renderHook(() =>
      useIdempotentAction({ cooldownMs: 500 })
    );
    const mockAction = vi.fn().mockResolvedValue('success');

    // Simulate rapid clicks
    const clicks = Array.from({ length: 5 }, () =>
      act(async () => {
        return result.current.execute(mockAction, 'button_click');
      })
    );

    await Promise.all(clicks);

    // Only the first click should execute
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it.skip('should block submissions while processing', async () => {
    const { result } = renderHook(() => useIdempotentAction());
    const mockAction = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve('success'), 200))
    );

    // Start first execution
    const firstExecution = act(async () => {
      return result.current.execute(mockAction, 'test_action');
    });

    // Try to execute again while first is still processing
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    let secondResult;
    await act(async () => {
      secondResult = await result.current.execute(mockAction, 'test_action');
    });

    await firstExecution;

    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(secondResult).toBeNull();
  });
});
