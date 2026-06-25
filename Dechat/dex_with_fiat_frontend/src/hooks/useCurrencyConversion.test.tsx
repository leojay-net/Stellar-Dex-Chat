import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    fetchCryptoPricesMock.mockResolvedValue({ XLM: { usd: 0.1 } });

    const first = await renderHook(10);
    expect(first.value.fiatAmount).toBe(1);
    first.cleanup();

    const second = await renderHook(20);
    expect(second.value.fiatAmount).toBe(2);
    second.cleanup();

    expect(fetchCryptoPricesMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    fetchCryptoPricesMock.mockResolvedValue({ XLM: { usd: 0.2 } });

    const third = await renderHook(20);
    expect(third.value.fiatAmount).toBe(4);
    third.cleanup();

    expect(fetchCryptoPricesMock).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses the cached rate', async () => {
    fetchCryptoPricesMock
      .mockResolvedValueOnce({ XLM: { usd: 0.1 } })
      .mockResolvedValueOnce({ XLM: { usd: 0.25 } });

    const hook = await renderHook(10);
    expect(hook.value.fiatAmount).toBe(1);

    await act(async () => {
      await hook.value.forceRefresh();
    });

    expect(hook.value.fiatAmount).toBe(2.5);
    expect(fetchCryptoPricesMock).toHaveBeenCalledTimes(2);
    hook.cleanup();
  });
});
