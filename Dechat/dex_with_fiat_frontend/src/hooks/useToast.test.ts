import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { useToast } from './useToast';
import { toastStore } from '@/lib/toastStore';

describe('useToast telemetry', () => {
  let dispatchedEvents: CustomEvent[] = [];
  let telemetryListener: (e: Event) => void;

  beforeEach(() => {
    dispatchedEvents = [];
    toastStore.clearToasts();
    telemetryListener = (e) => {
      dispatchedEvents.push(e as CustomEvent);
    };
    window.addEventListener('toast_telemetry', telemetryListener);
  });

  afterEach(() => {
    window.removeEventListener('toast_telemetry', telemetryListener);
    toastStore.clearToasts();
  });

  it('dispatches toast_added event when addToast is called', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast('Hello world', 'success');
    });

    const addedEvents = dispatchedEvents.filter(
      (e) => e.detail?.event === 'toast_added',
    );
    expect(addedEvents).toHaveLength(1);
    expect(addedEvents[0].detail.message).toBe('Hello world');
    expect(addedEvents[0].detail.variant).toBe('success');
  });

  it('dispatches toast_added with options object form', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast({ message: 'Options form', variant: 'error' });
    });

    const addedEvents = dispatchedEvents.filter(
      (e) => e.detail?.event === 'toast_added',
    );
    expect(addedEvents).toHaveLength(1);
    expect(addedEvents[0].detail.message).toBe('Options form');
    expect(addedEvents[0].detail.variant).toBe('error');
  });

  it('dispatches toast_dismissed event when dismissToast is called', () => {
    const { result } = renderHook(() => useToast());

    let toastId: string | null = null;
    act(() => {
      toastId = result.current.addToast('Dismiss me', 'info');
    });

    act(() => {
      if (toastId) result.current.dismissToast(toastId);
    });

    const dismissedEvents = dispatchedEvents.filter(
      (e) => e.detail?.event === 'toast_dismissed',
    );
    expect(dismissedEvents).toHaveLength(1);
    expect(dismissedEvents[0].detail.id).toBe(toastId);
  });

  it('dispatches toasts_cleared event when clearToasts is called', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast('First', 'info');
      result.current.addToast('Second', 'warning');
    });

    act(() => {
      result.current.clearToasts();
    });

    const clearedEvents = dispatchedEvents.filter(
      (e) => e.detail?.event === 'toasts_cleared',
    );
    expect(clearedEvents).toHaveLength(1);
    expect(clearedEvents[0].detail.count).toBe(2);
  });

  it('includes deduped flag when toast is suppressed by deduplication', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast('Duplicate', 'info');
      result.current.addToast('Duplicate', 'info');
    });

    const addedEvents = dispatchedEvents.filter(
      (e) => e.detail?.event === 'toast_added',
    );
    expect(addedEvents).toHaveLength(2);
    expect(addedEvents[0].detail.deduped).toBe(false);
    expect(addedEvents[1].detail.deduped).toBe(true);
  });

  it('returns toasts from the store', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast('Visible toast', 'success');
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Visible toast');
  });
});
