import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  calculateContrastRatio,
  chatTelemetry,
  getAccessibleAvatarTextColor,
  getTelemetryConsent,
  setTelemetryConsent,
  TELEMETRY_SCHEMA_VERSION,
  telemetryMotionVariants,
  type ChatEvent,
  type AccessibleAvatarColorTelemetryPayload,
  type MessageSendPayload,
  type MessageRetryPayload,
  type WalletConnectPayload,
  type BridgeOpenPayload,
  type TxConfirmPayload,
  withAccessibleAvatarContrast,
} from './chatTelemetry';

// ── helpers ────────────────────────────────────────────────────────────────

function captureNextEvent<P extends object>(): Promise<ChatEvent<P>> {
  return new Promise((resolve) => {
    window.addEventListener(
      'chat:telemetry',
      (e) => resolve((e as CustomEvent<ChatEvent<P>>).detail),
      { once: true },
    );
  });
}

// ── consent ────────────────────────────────────────────────────────────────

describe('Telemetry consent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to false when no consent is stored', () => {
    expect(getTelemetryConsent()).toBe(false);
  });

  it('returns true after consent is granted', () => {
    setTelemetryConsent(true);
    expect(getTelemetryConsent()).toBe(true);
  });

  it('returns false after consent is revoked', () => {
    setTelemetryConsent(true);
    setTelemetryConsent(false);
    expect(getTelemetryConsent()).toBe(false);
  });
});

// ── event suppression ──────────────────────────────────────────────────────

describe('Event suppression without consent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not dispatch events when consent is false', () => {
    const handler = vi.fn();
    window.addEventListener('chat:telemetry', handler);
    chatTelemetry.messageSend({ messageLength: 5, hasWallet: true });
    window.removeEventListener('chat:telemetry', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── payload shape ──────────────────────────────────────────────────────────

describe('Event payload shapes', () => {
  beforeEach(() => {
    localStorage.clear();
    setTelemetryConsent(true);
  });

  it('message_send has correct schema', async () => {
    const promise = captureNextEvent<MessageSendPayload>();
    chatTelemetry.messageSend({ messageLength: 42, hasWallet: true });
    const event = await promise;

    expect(event.name).toBe('message_send');
    expect(event.version).toBe(TELEMETRY_SCHEMA_VERSION);
    expect(typeof event.timestamp).toBe('number');

    const payload = event.payload;
    expect(payload.messageLength).toBe(42);
    expect(payload.hasWallet).toBe(true);
  });

  it('message_retry has correct schema', async () => {
    const promise = captureNextEvent<MessageRetryPayload>();
    chatTelemetry.messageRetry({ retryAttempts: 2, errorMessage: 'timeout' });
    const event = await promise;

    expect(event.name).toBe('message_retry');
    const payload = event.payload;
    expect(payload.retryAttempts).toBe(2);
    expect(payload.errorMessage).toBe('timeout');
  });

  it('wallet_connect has correct schema', async () => {
    const promise = captureNextEvent<WalletConnectPayload>();
    chatTelemetry.walletConnect({ walletType: 'freighter', success: true });
    const event = await promise;

    expect(event.name).toBe('wallet_connect');
    const payload = event.payload;
    expect(payload.walletType).toBe('freighter');
    expect(payload.success).toBe(true);
  });

  it('bridge_open has correct schema', async () => {
    const promise = captureNextEvent<BridgeOpenPayload>();
    chatTelemetry.bridgeOpen({ flow: 'deposit' });
    const event = await promise;

    expect(event.name).toBe('bridge_open');
    const payload = event.payload;
    expect(payload.flow).toBe('deposit');
  });

  it('tx_confirm has correct schema', async () => {
    const promise = captureNextEvent<TxConfirmPayload>();
    chatTelemetry.txConfirm({ assetCode: 'XLM', amountXlm: 10, network: 'TESTNET' });
    const event = await promise;

    expect(event.name).toBe('tx_confirm');
    const payload = event.payload;
    expect(payload.assetCode).toBe('XLM');
    expect(payload.network).toBe('TESTNET');
  });

  it('every event includes the schema version', async () => {
    const promise = captureNextEvent<MessageSendPayload>();
    chatTelemetry.messageSend({ messageLength: 1, hasWallet: false });
    const event = await promise;

    expect(event.version).toBe(TELEMETRY_SCHEMA_VERSION);
  });

  it('normalizes avatar colors to an accessible text color when needed', async () => {
    const promise = captureNextEvent<
      MessageSendPayload & AccessibleAvatarColorTelemetryPayload
    >();

    chatTelemetry.messageSend({
      messageLength: 12,
      hasWallet: true,
      avatarBackgroundColor: '#F3F4F6',
      avatarTextColor: '#FFFFFF',
    } as MessageSendPayload & {
      avatarBackgroundColor: string;
      avatarTextColor: string;
    });

    const event = await promise;
    const payload = event.payload;

    expect(payload.avatarBackgroundColor).toBe('#F3F4F6');
    expect(payload.avatarTextColor).toBe('#111827');
    expect(payload.avatarContrastCompliant).toBe(true);
    expect(payload.avatarContrastRatio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Avatar contrast helpers', () => {
  it('calculates the expected contrast ratio for a compliant avatar pair', () => {
    expect(calculateContrastRatio('#FFFFFF', '#2563EB')).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('keeps the preferred avatar text color when it is already accessible', () => {
    expect(getAccessibleAvatarTextColor('#2563EB', '#FFFFFF')).toBe('#FFFFFF');
  });

  it('switches to a darker avatar text color when light text is not accessible', () => {
    expect(getAccessibleAvatarTextColor('#F3F4F6', '#FFFFFF')).toBe('#111827');
  });

});

describe('Telemetry motion variants', () => {
  it('exposes framer-motion variants for hidden/visible/exit', () => {
    expect(telemetryMotionVariants.hidden).toBeDefined();
    expect(telemetryMotionVariants.visible).toBeDefined();
    expect(telemetryMotionVariants.exit).toBeDefined();
  });
});

// ── Regression test for issue #539 ────────────────────────────────────────

describe('Rendering overflow fix (issue #539)', () => {
  beforeEach(() => {
    localStorage.clear();
    setTelemetryConsent(true);
  });

  it('defers event dispatch using requestAnimationFrame to prevent render blocking', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const handler = vi.fn();

    window.addEventListener('chat:telemetry', handler);

    chatTelemetry.messageSend({ messageLength: 5, hasWallet: true });

    // Event should not be dispatched synchronously
    expect(handler).not.toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalled();

    // Wait for requestAnimationFrame to execute
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('chat:telemetry', handler);
    rafSpy.mockRestore();
  });

  it('returns the same payload reference when no avatar colors are present', () => {
    const payload = { messageLength: 10, hasWallet: true };
    const result = withAccessibleAvatarContrast(payload);

    // Should return the exact same reference to prevent unnecessary re-renders
    expect(result).toBe(payload);
  });

  it('creates a new object only when avatar colors are present', () => {
    const payload = {
      messageLength: 10,
      hasWallet: true,
      avatarBackgroundColor: '#2563EB',
    };
    const result = withAccessibleAvatarContrast(payload);

    // Should create a new object with additional properties
    expect(result).not.toBe(payload);
    expect(result).toHaveProperty('avatarTextColor');
    expect(result).toHaveProperty('avatarContrastRatio');
    expect(result).toHaveProperty('avatarContrastCompliant');
  });

  it('handles rapid successive telemetry calls without blocking', async () => {
    const handler = vi.fn();
    window.addEventListener('chat:telemetry', handler);

    // Simulate rapid successive calls that could cause rendering overflow
    for (let i = 0; i < 10; i++) {
      chatTelemetry.messageSend({ messageLength: i, hasWallet: true });
    }

    // Events should not be dispatched synchronously
    expect(handler).not.toHaveBeenCalled();

    // Wait for all requestAnimationFrame callbacks to execute
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
    });

    // All events should eventually be dispatched
    expect(handler).toHaveBeenCalledTimes(10);

    window.removeEventListener('chat:telemetry', handler);
  });

  // ── avatar_color_check event (issue #521) ─────────────────────────────

  it('avatarColorCheck emits avatar_color_check event with enriched payload', async () => {
    const promise = captureNextEvent<AccessibleAvatarColorTelemetryPayload>();
    chatTelemetry.avatarColorCheck({ avatarBackgroundColor: '#1a1a2e' });
    const event = await promise;

    expect(event.name).toBe('avatar_color_check');
    expect(event.payload).toHaveProperty('avatarBackgroundColor');
    expect(event.payload).toHaveProperty('avatarTextColor');
    expect(event.payload).toHaveProperty('avatarContrastRatio');
    expect(event.payload).toHaveProperty('avatarContrastCompliant');
  });

  it('avatarColorCheck marks dark background as contrast-compliant with white text', async () => {
    const promise = captureNextEvent<AccessibleAvatarColorTelemetryPayload>();
    chatTelemetry.avatarColorCheck({ avatarBackgroundColor: '#000000' });
    const event = await promise;

    expect(event.payload.avatarContrastCompliant).toBe(true);
    expect(event.payload.avatarContrastRatio).toBeGreaterThanOrEqual(4.5);
  });

  it('avatarColorCheck marks light background as contrast-compliant with dark text', async () => {
    const promise = captureNextEvent<AccessibleAvatarColorTelemetryPayload>();
    chatTelemetry.avatarColorCheck({ avatarBackgroundColor: '#FFFFFF' });
    const event = await promise;

    expect(event.payload.avatarContrastCompliant).toBe(true);
    expect(event.payload.avatarContrastRatio).toBeGreaterThanOrEqual(4.5);
  });

  it('avatarColorCheck does not emit when consent is not given', () => {
    setTelemetryConsent(false);
    const handler = vi.fn();
    window.addEventListener('chat:telemetry', handler);
    chatTelemetry.avatarColorCheck({ avatarBackgroundColor: '#FF0000' });
    window.removeEventListener('chat:telemetry', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Error boundary tests ───────────────────────────────────────────────────

describe('Error boundary behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    setTelemetryConsent(true);
  });

  it('handles invalid color values in normalizeHexColor gracefully', () => {
    expect(calculateContrastRatio('invalid', '#FFFFFF')).toBeNull();
    expect(calculateContrastRatio('#FFFFFF', 'invalid')).toBeNull();
    expect(calculateContrastRatio(null as any, '#FFFFFF')).toBeNull();
    expect(calculateContrastRatio('#FFFFFF', null as any)).toBeNull();
  });

  it('handles malformed color values gracefully', () => {
    expect(calculateContrastRatio('#', '#FFFFFF')).toBeNull();
    expect(calculateContrastRatio('#FF', '#FFFFFF')).toBeNull();
    expect(calculateContrastRatio('#FFFFF', '#FFFFFF')).toBeNull();
    expect(calculateContrastRatio('#FFFFFFF', '#FFFFFF')).toBeNull();
  });

  it('returns fallback text color when color calculation fails', () => {
    const result = getAccessibleAvatarTextColor('invalid', '#FFFFFF');
    expect(result).toBe('#FFFFFF');
  });

  it('returns original payload when withAccessibleAvatarContrast fails', () => {
    const payload = { messageLength: 10, hasWallet: true };
    const result = withAccessibleAvatarContrast(payload);
    expect(result).toBe(payload);
  });

  it('continues to emit events even if contrast calculation fails', async () => {
    const handler = vi.fn();
    window.addEventListener('chat:telemetry', handler);

    // This should not throw even with invalid color values
    chatTelemetry.messageSend({
      messageLength: 5,
      hasWallet: true,
      avatarBackgroundColor: 'invalid-color',
    } as any);

    // Wait for requestAnimationFrame to execute
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    // Event should still be emitted (with original payload)
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('chat:telemetry', handler);
  });

  it('does not throw when window.dispatchEvent fails', async () => {
    const dispatchSpy = vi
      .spyOn(window, 'dispatchEvent')
      .mockImplementation(() => {
        throw new Error('Dispatch error');
      });

    // This should not throw
    expect(() => {
      chatTelemetry.messageSend({ messageLength: 5, hasWallet: true });
    }).not.toThrow();

    // Wait for requestAnimationFrame to execute
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    dispatchSpy.mockRestore();
  });

  it('does not throw when requestAnimationFrame is not available', () => {
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => {
        throw new Error('RAF not available');
      });

    // This should not throw
    expect(() => {
      chatTelemetry.messageSend({ messageLength: 5, hasWallet: true });
    }).not.toThrow();

    rafSpy.mockRestore();
  });

  it('handles errors in getTelemetryConsent gracefully', () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('Storage error');
      });

    // Should return false instead of throwing
    expect(getTelemetryConsent()).toBe(false);

    getItemSpy.mockRestore();
  });

  it('handles errors in setTelemetryConsent gracefully', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Storage error');
      });

    // Should not throw
    expect(() => {
      setTelemetryConsent(true);
    }).not.toThrow();

    setItemSpy.mockRestore();
  });
});
