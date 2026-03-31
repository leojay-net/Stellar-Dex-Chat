import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStore } from './toastStore';

describe('ToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates identical toasts within the dedupe window', () => {
    let now = 1000;
    let nextId = 0;
    const store = new ToastStore({
      dedupeWindowMs: 2500,
      defaultDurationMs: 5000,
      now: () => now,
      generateId: () => `toast-${++nextId}`,
    });

    const firstId = store.addToast({
      message: 'Payment submitted',
      severity: 'info',
    });
    expect(firstId).toBe('toast-1');
    expect(store.getSnapshot()).toHaveLength(1);

    now = 1500;
    const deduped = store.addToast({
      message: 'Payment submitted',
      severity: 'info',
    });
    expect(deduped).toBeNull();
    expect(store.getSnapshot()).toHaveLength(1);

    now = 4000;
    const secondId = store.addToast({
      message: 'Payment submitted',
      severity: 'info',
    });
    expect(secondId).toBe('toast-2');
    expect(store.getSnapshot()).toHaveLength(2);
  });

  it('handles dismissal lifecycle for manual and auto dismiss', () => {
    let nextId = 0;
    const store = new ToastStore({
      dedupeWindowMs: 0,
      defaultDurationMs: 1200,
      generateId: () => `toast-${++nextId}`,
    });

    const autoId = store.addToast({
      message: 'Auto dismiss me',
      severity: 'success',
    });
    const manualId = store.addToast({
      message: 'Dismiss me manually',
      severity: 'warning',
    });
    expect(autoId).toBe('toast-1');
    expect(manualId).toBe('toast-2');
    expect(store.getSnapshot()).toHaveLength(2);

    store.dismissToast('toast-2');
    expect(store.getSnapshot().map((toast) => toast.id)).toEqual(['toast-1']);

    vi.advanceTimersByTime(1200);
    expect(store.getSnapshot()).toHaveLength(0);
  });
});
