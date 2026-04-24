import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  calculateContrastRatio,
  chatTelemetry,
  getAccessibleAvatarTextColor,
  getTelemetryConsent,
  setTelemetryConsent,
  TELEMETRY_SCHEMA_VERSION,
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

  it('leaves payloads without avatar colors unchanged', () => {
    const payload = { messageLength: 10, hasWallet: true };

    expect(withAccessibleAvatarContrast(payload)).toEqual(payload);
  });
});
