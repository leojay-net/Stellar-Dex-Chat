import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchCryptoPricesMock } = vi.hoisted(() => ({
  fetchCryptoPricesMock: vi.fn(),
}));

vi.mock('@/lib/cryptoPriceService', () => ({
  fetchCryptoPrices: fetchCryptoPricesMock,
}));

vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({
    fiatCurrency: 'usd',
  }),
}));

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderHook(amount: number, tokenSymbol = 'XLM') {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const { useCurrencyConversion } = await import('./useCurrencyConversion');
  let value: ReturnType<typeof useCurrencyConversion> | null = null;

  function Harness() {
    value = useCurrencyConversion(amount, tokenSymbol);
    return null;
  }

  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  await flushEffects();

  return {
    get value() {
      return value!;
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useCurrencyConversion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:00:00Z'));
    vi.resetModules();
    fetchCryptoPricesMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches exchange rates for 60 seconds', async () => {
    fetchCryptoPricesMock.mockResolvedValue({
      prices: { XLM: { usd: 0.1 } },
      stale: false,
      source: 'live',
    });

    const first = await renderHook(10);
    expect(first.value.fiatAmount).toBe(1);
    first.cleanup();

    const second = await renderHook(20);
    expect(second.value.fiatAmount).toBe(2);
    second.cleanup();

    expect(fetchCryptoPricesMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    fetchCryptoPricesMock.mockResolvedValue({
      prices: { XLM: { usd: 0.2 } },
      stale: false,
      source: 'live',
    });

    const third = await renderHook(20);
    expect(third.value.fiatAmount).toBe(4);
    third.cleanup();

    expect(fetchCryptoPricesMock).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses the cached rate', async () => {
    fetchCryptoPricesMock
      .mockResolvedValueOnce({
        prices: { XLM: { usd: 0.1 } },
        stale: false,
        source: 'live',
      })
      .mockResolvedValueOnce({
        prices: { XLM: { usd: 0.25 } },
        stale: false,
        source: 'live',
      });

    const hook = await renderHook(10);
    expect(hook.value.fiatAmount).toBe(1);

    await act(async () => {
      await hook.value.forceRefresh();
    });

    expect(hook.value.fiatAmount).toBe(2.5);
    expect(fetchCryptoPricesMock).toHaveBeenCalledTimes(2);
    hook.cleanup();
  });

  // Memory-leak regression test (#1217)
  // Verifies that an in-flight fetch that resolves after unmount does NOT
  // attempt to call setState on the unmounted component.
  it('does not call setState after unmount (memory-leak fix #1217)', async () => {
    let resolveFetch!: (value: {
      prices: Record<string, Record<string, number>>;
      stale: boolean;
      source: 'live' | 'cache' | 'fallback';
    }) => void;
    fetchCryptoPricesMock.mockReturnValue(
      new Promise<{
        prices: Record<string, Record<string, number>>;
        stale: boolean;
        source: 'live' | 'cache' | 'fallback';
      }>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    // Spy on console.error to detect React's "state update on unmounted
    // component" warning, which would fire if the bug were still present.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const hook = await renderHook(10);

    // Unmount before the fetch resolves
    hook.cleanup();

    // Now resolve the fetch — without the fix this would call setState on the
    // unmounted component and React would warn.
    await act(async () => {
      resolveFetch({
        prices: { XLM: { usd: 0.5 } },
        stale: false,
        source: 'live',
      });
      await Promise.resolve();
    });

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unmounted'),
    );
    consoleSpy.mockRestore();
  });
});
