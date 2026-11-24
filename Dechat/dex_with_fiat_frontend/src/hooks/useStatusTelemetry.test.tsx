import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTelemetryConsent, type ChatEvent } from '@/lib/chatTelemetry';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useOnlineStatus } from './useOnlineStatus';

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock('@/lib/clientSession', () => ({
  getOrCreateClientSessionId: () => 'session-1',
}));

class MockEventSource {
  static latest: MockEventSource | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    void url;
    MockEventSource.latest = this;
  }
}

function captureEvent(): Promise<ChatEvent> {
  return new Promise((resolve) => {
    window.addEventListener(
      'chat:telemetry',
      (event) => resolve((event as CustomEvent<ChatEvent>).detail),
      { once: true },
    );
  });
}

describe('status telemetry hooks', () => {
  beforeEach(() => {
    localStorage.clear();
    setTelemetryConsent(true);
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('emits a structured payment-status event without exposing payment values', async () => {
    const { usePaystackWebhookStatus } =
      await import('./usePaystackWebhookStatus');
    renderHook(() => usePaystackWebhookStatus());
    const eventPromise = captureEvent();

    act(() => {
      MockEventSource.latest?.onmessage?.({
        data: JSON.stringify({
          reference: 'payment-ref',
          status: 'success',
          amount: 1200,
        }),
      } as MessageEvent);
    });

    await expect(eventPromise).resolves.toMatchObject({
      name: 'payment_status',
      payload: {
        reference: 'payment-ref',
        status: 'success',
        hasAmount: true,
        hasFailureReason: false,
      },
    });
  });

  it('emits the online state in both light and dark theme documents', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    for (const theme of ['light', 'dark']) {
      localStorage.setItem('theme', theme);
      const eventPromise = captureEvent();
      const { unmount } = renderHook(() => useOnlineStatus(), {
        wrapper: ThemeProvider,
      });

      await expect(eventPromise).resolves.toMatchObject({
        name: 'network_status',
        payload: { status: 'offline', source: 'initial' },
      });
      unmount();
    }
  });

  it('emits an offline browser-event transition', async () => {
    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current.isOnline).toBeDefined());
    const eventPromise = captureEvent();

    act(() => window.dispatchEvent(new Event('offline')));

    await expect(eventPromise).resolves.toMatchObject({
      name: 'network_status',
      payload: { status: 'offline', source: 'browser-event' },
    });
  });
});
