import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffectiveDarkMode } from '../useEffectiveDarkMode';
import { useTheme } from '@/contexts/ThemeContext';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isDarkMode: false, toggleDarkMode: vi.fn() })),
}));

describe('useEffectiveDarkMode', () => {
  let addEventListenerSpy: any;
  let removeEventListenerSpy: any;
  let mutationObserverDisconnectSpy: any;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.clearAllMocks();

    addEventListenerSpy = vi.fn();
    removeEventListenerSpy = vi.fn();
    mutationObserverDisconnectSpy = vi.fn();

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
        dispatchEvent: vi.fn(),
      })),
    });

    // Mock MutationObserver. mockImplementation must be a regular function,
    // not an arrow function — `new MutationObserver(...)` invokes it via
    // [[Construct]], which arrow functions don't support.
    global.MutationObserver = vi.fn().mockImplementation(function (callback) {
      return {
        observe: vi.fn(),
        disconnect: mutationObserverDisconnectSpy,
        takeRecords: vi.fn(),
        _callback: callback,
      };
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers data-theme="dark" on the document element', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(true);
  });

  it('prefers data-theme="light" on the document element', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(false);
  });

  it('falls back to ThemeContext isDarkMode when data-theme is null', () => {
    vi.mocked(useTheme).mockReturnValue({ isDarkMode: true, toggleDarkMode: vi.fn() });
    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(true);
  });

  it('falls back to prefers-color-scheme: dark when data-theme is null and isDarkMode is false', () => {
    vi.mocked(useTheme).mockReturnValue({ isDarkMode: false, toggleDarkMode: vi.fn() });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
      })),
    });

    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(true);
  });

  it('reacts to media query change events', () => {
    vi.mocked(useTheme).mockReturnValue({ isDarkMode: false, toggleDarkMode: vi.fn() });
    let mediaQueryHandler: (e: MediaQueryListEvent) => void = () => {};

    addEventListenerSpy.mockImplementation((event: string, handler: any) => {
      if (event === 'change') {
        mediaQueryHandler = handler;
      }
    });

    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(false);

    act(() => {
      mediaQueryHandler({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });

  it('reacts to data-theme MutationObserver callbacks', () => {
    let observerCallback: () => void = () => {};
    global.MutationObserver = vi.fn().mockImplementation(function (callback) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        disconnect: mutationObserverDisconnectSpy,
      };
    }) as any;

    const { result } = renderHook(() => useEffectiveDarkMode());
    expect(result.current).toBe(false);

    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      observerCallback();
    });

    expect(result.current).toBe(true);
  });

  it('unsubscribes media query listener and disconnects MutationObserver on unmount', () => {
    const { unmount } = renderHook(() => useEffectiveDarkMode());
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
    expect(mutationObserverDisconnectSpy).toHaveBeenCalledTimes(1);
  });
});
