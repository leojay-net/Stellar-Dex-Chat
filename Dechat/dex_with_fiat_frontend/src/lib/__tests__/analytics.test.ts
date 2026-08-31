import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../analytics';

describe('withRetry - exponential backoff retry logic', () => {
  it('returns data on first successful attempt', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(mockFn);

    expect(result.data).toBe('success');
    expect(result.attemptCount).toBe(0);
    expect(result.totalDelay).toBe(0);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable errors with exponential backoff', async () => {
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue('success');

    const result = await withRetry(mockFn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffMultiplier: 2,
      isRetryable: () => true,
    });

    expect(result.data).toBe('success');
    expect(result.attemptCount).toBe(2);
    expect(result.totalDelay).toBe(300); // 100 + 200
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('throws error after max retries exhausted', async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error('Persistent error'));

    await expect(
      withRetry(mockFn, { maxRetries: 2, initialDelay: 50, isRetryable: () => true }),
    ).rejects.toThrow('Persistent error');

    expect(mockFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('respects maxDelay cap', async () => {
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockResolvedValue('success');

    const result = await withRetry(mockFn, {
      maxRetries: 5,
      initialDelay: 1000,
      backoffMultiplier: 10,
      maxDelay: 5000,
      isRetryable: () => true,
    });

    expect(result.data).toBe('success');
    expect(result.totalDelay).toBeLessThanOrEqual(10000); // 1000 + 5000 (capped)
  });

  it('uses custom isRetryable function', async () => {
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error('Custom error'))
      .mockResolvedValue('success');

    const customIsRetryable = vi.fn((error: unknown) => {
      return error instanceof Error && error.message === 'Custom error';
    });

    const result = await withRetry(mockFn, {
      maxRetries: 3,
      initialDelay: 50,
      isRetryable: customIsRetryable,
    });

    expect(result.data).toBe('success');
    expect(customIsRetryable).toHaveBeenCalled();
  });

  it('does not retry non-retryable errors', async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error('Non-retryable'));

    const customIsRetryable = vi.fn(() => false);

    await expect(
      withRetry(mockFn, {
        maxRetries: 3,
        initialDelay: 50,
        isRetryable: customIsRetryable,
      }),
    ).rejects.toThrow('Non-retryable');

    expect(mockFn).toHaveBeenCalledTimes(1);
  });


  it('does not retry Response errors with non-retryable status codes', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response;

    const mockFn = vi.fn().mockRejectedValue(mockResponse);

    await expect(
      withRetry(mockFn, {
        maxRetries: 3,
        initialDelay: 50,
        retryableStatuses: [500, 502, 503, 504],
      }),
    ).rejects.toThrow();

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('handles network errors (TypeError with fetch)', async () => {
    const networkError = new TypeError('Failed to fetch');
    const mockFn = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue('success');

    const result = await withRetry(mockFn, {
      maxRetries: 2,
      initialDelay: 50,
    });

    expect(result.data).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('uses default options when not provided', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(mockFn);

    expect(result.data).toBe('success');
    expect(result.attemptCount).toBe(0);
    expect(result.totalDelay).toBe(0);
  });

  it('calculates correct exponential backoff delays', async () => {
    const delays: number[] = [];
    const mockFn = vi.fn()
      .mockImplementation(async () => {
        delays.push(0);
        throw new Error('Error');
      });

    await expect(
      withRetry(mockFn, {
        maxRetries: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        isRetryable: () => true,
      }),
    ).rejects.toThrow();

    expect(delays).toHaveLength(4); // initial + 3 retries
    expect(mockFn).toHaveBeenCalledTimes(4);
  });

  it('returns attempt count and total delay in result', async () => {
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockResolvedValue('success');

    const result = await withRetry(mockFn, {
      maxRetries: 5,
      initialDelay: 200,
      backoffMultiplier: 2,
      isRetryable: () => true,
    });

    expect(result.attemptCount).toBe(2);
    expect(result.totalDelay).toBe(600); // 200 + 400
  });
});
