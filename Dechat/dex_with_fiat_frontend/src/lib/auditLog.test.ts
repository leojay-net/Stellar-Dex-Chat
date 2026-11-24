import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLogService, { retryWithBackoff } from './auditLog';

describe('auditLog retry helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a failed operation and succeeds with exponential backoff', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage fail'))
      .mockResolvedValueOnce('ok');

    const promise = retryWithBackoff(operation, {
      retries: 2,
      minDelayMs: 50,
      factor: 2,
    });

    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('persists an audit entry to localStorage when recordAction is called', async () => {
    const entry = AuditLogService.recordAction(
      'admin1',
      'deposit',
      'Test deposit',
      { amount: 42 },
      'txhash',
      'success',
    );

    await Promise.resolve();

    const stored = JSON.parse(
      localStorage.getItem('audit_log_entries') ?? '[]',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: entry.id,
      adminAddress: 'admin1',
      actionType: 'deposit',
      actionDescription: 'Test deposit',
      txHash: 'txhash',
      status: 'success',
    });
  });
});
