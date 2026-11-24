import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, retryWithBackoff } from './ccipExplorer';

describe('ccipExplorer retry helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a failing operation with exponential backoff and eventually succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('network fail'))
      .mockResolvedValueOnce('ok');

    const promise = retryWithBackoff(operation, {
      retries: 2,
      minDelayMs: 100,
      factor: 2,
    });

    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('fetchWithRetry retries fetch when the first request fails', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(response);

    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://example.com', undefined, {
      retries: 2,
      minDelayMs: 100,
      factor: 2,
    });

    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
