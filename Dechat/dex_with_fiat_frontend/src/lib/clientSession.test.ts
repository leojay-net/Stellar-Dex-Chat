import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getOrCreateClientSessionId', () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('returns the same id across repeated calls in a healthy environment', async () => {
    const { getOrCreateClientSessionId } = await import('./clientSession');

    const first = getOrCreateClientSessionId();
    const second = getOrCreateClientSessionId();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('reuses an id already stored in sessionStorage', async () => {
    window.sessionStorage.setItem('stellar_client_session_id', 'existing-id');
    const { getOrCreateClientSessionId } = await import('./clientSession');

    expect(getOrCreateClientSessionId()).toBe('existing-id');
  });

  it('regression: stays consistent across calls even when sessionStorage.setItem throws (e.g. private-browsing quota errors)', async () => {
    // Simulate a browser environment where writes to sessionStorage throw
    // (Safari private mode, exhausted quota, sandboxed iframe, etc).
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(
      () => {
        throw new DOMException('QuotaExceededError');
      },
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { getOrCreateClientSessionId, clientSessionUsedFallbackStorage } =
      await import('./clientSession');

    const first = getOrCreateClientSessionId();
    const second = getOrCreateClientSessionId();

    // Before the fix, every call independently generated a new id whenever
    // persistence failed, so `first !== second` here. The fix caches the
    // resolved id in module scope so both calls agree.
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    // The failure is surfaced (not silent) via a console error the caller
    // can observe/monitor, and via the exported fallback-status flag.
    expect(clientSessionUsedFallbackStorage()).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns an empty string during SSR (no window)', async () => {
    const { getOrCreateClientSessionId } = await import('./clientSession');
    const originalWindow = globalThis.window;
    // @ts-expect-error - simulating SSR where window is undefined
    delete globalThis.window;

    expect(getOrCreateClientSessionId()).toBe('');

    globalThis.window = originalWindow;
  });
});
