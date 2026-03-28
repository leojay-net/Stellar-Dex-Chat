'use client';

// ── Schema ────────────────────────────────────────────────────────────────

/** Bump when the event payload shape changes in a breaking way. */
export const TELEMETRY_SCHEMA_VERSION = '1.0.0';

export type ChatEventName =
  | 'message_send'
  | 'message_retry'
  | 'wallet_connect'
  | 'bridge_open'
  | 'tx_confirm';

export interface ChatEvent<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Normalized event name. */
  name: ChatEventName;
  /** Schema version for this payload shape. */
  version: string;
  /** Unix timestamp (ms) when the event was emitted. */
  timestamp: number;
  /** Arbitrary event-specific payload. */
  payload: P;
}

// ── Typed payloads ────────────────────────────────────────────────────────

export interface MessageSendPayload {
  messageLength: number;
  hasWallet: boolean;
}

export interface MessageRetryPayload {
  retryAttempts: number;
  errorMessage?: string;
}

export interface WalletConnectPayload {
  walletType: string;
  success: boolean;
}

export interface BridgeOpenPayload {
  flow: 'deposit' | 'withdraw';
}

export interface TxConfirmPayload {
  assetCode: string;
  amountXlm?: number;
  network: string;
}

// ── Consent key ───────────────────────────────────────────────────────────

const CONSENT_KEY = 'nova_telemetry_consent';

export function getTelemetryConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTelemetryConsent(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      localStorage.setItem(CONSENT_KEY, 'true');
    } else {
      localStorage.removeItem(CONSENT_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

// ── Emitter ───────────────────────────────────────────────────────────────

/**
 * Emit a telemetry event. No-ops if the user has not consented.
 * Dispatches a CustomEvent on window so any listener can react
 * (analytics adapters, logging, etc.) without tight coupling.
 */
function emit<P extends object>(
  name: ChatEventName,
  payload: P,
): void {
  if (!getTelemetryConsent()) return;

  const event: ChatEvent = {
    name,
    version: TELEMETRY_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: payload as Record<string, unknown>,
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('chat:telemetry', { detail: event }),
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export const chatTelemetry = {
  messageSend(payload: MessageSendPayload): void {
    emit('message_send', payload);
  },

  messageRetry(payload: MessageRetryPayload): void {
    emit('message_retry', payload);
  },

  walletConnect(payload: WalletConnectPayload): void {
    emit('wallet_connect', payload);
  },

  bridgeOpen(payload: BridgeOpenPayload): void {
    emit('bridge_open', payload);
  },

  txConfirm(payload: TxConfirmPayload): void {
    emit('tx_confirm', payload);
  },
};
