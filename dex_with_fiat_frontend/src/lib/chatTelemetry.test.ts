import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  chatTelemetry,
  getTelemetryConsent,
  setTelemetryConsent,
  TELEMETRY_SCHEMA_VERSION,
  type ChatEvent,
  type MessageSendPayload,
  type MessageRetryPayload,
  type WalletConnectPayload,
  type BridgeOpenPayload,
  type TxConfirmPayload,
} from './chatTelemetry';

// ── helpers ────────────────────────────────────────────────────────────────

function captureNextEvent(): Promise<ChatEvent> {
  return new Promise((resolve) => {
    window.addEventListener(
      'chat:telemetry',
      (e) => resolve((e as CustomEvent<ChatEvent>).detail),
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
    const promise = captureNextEvent();
    chatTelemetry.messageSend({ messageLength: 42, hasWallet: true });
    const event = await promise;

    expect(event.name).toBe('message_send');
    expect(event.version).toBe(TELEMETRY_SCHEMA_VERSION);
    expect(typeof event.timestamp).toBe('number');

    const payload = event.payload as MessageSendPayload;
    expect(payload.messageLength).toBe(42);
    expect(payload.hasWallet).toBe(true);
  });

  it('message_retry has correct schema', async () => {
    const promise = captureNextEvent();
    chatTelemetry.messageRetry({ retryAttempts: 2, errorMessage: 'timeout' });
    const event = await promise;

    expect(event.name).toBe('message_retry');
    const payload = event.payload as MessageRetryPayload;
    expect(payload.retryAttempts).toBe(2);
    expect(payload.errorMessage).toBe('timeout');
  });

  it('wallet_connect has correct schema', async () => {
    const promise = captureNextEvent();
    chatTelemetry.walletConnect({ walletType: 'freighter', success: true });
    const event = await promise;

    expect(event.name).toBe('wallet_connect');
    const payload = event.payload as WalletConnectPayload;
    expect(payload.walletType).toBe('freighter');
    expect(payload.success).toBe(true);
  });

  it('bridge_open has correct schema', async () => {
    const promise = captureNextEvent();
    chatTelemetry.bridgeOpen({ flow: 'deposit' });
    const event = await promise;

    expect(event.name).toBe('bridge_open');
    const payload = event.payload as BridgeOpenPayload;
    expect(payload.flow).toBe('deposit');
  });

  it('tx_confirm has correct schema', async () => {
    const promise = captureNextEvent();
    chatTelemetry.txConfirm({ assetCode: 'XLM', amountXlm: 10, network: 'TESTNET' });
    const event = await promise;

    expect(event.name).toBe('tx_confirm');
    const payload = event.payload as TxConfirmPayload;
    expect(payload.assetCode).toBe('XLM');
    expect(payload.network).toBe('TESTNET');
  });

  it('every event includes the schema version', async () => {
    const promise = captureNextEvent();
    chatTelemetry.messageSend({ messageLength: 1, hasWallet: false });
    const event = await promise;

    expect(event.version).toBe(TELEMETRY_SCHEMA_VERSION);
  });
});
