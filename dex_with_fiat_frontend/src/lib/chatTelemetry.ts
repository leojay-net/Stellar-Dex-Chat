'use client';
import type { Variants } from 'framer-motion';

// ── Schema ────────────────────────────────────────────────────────────────

/** Bump when the event payload shape changes in a breaking way. */
export const TELEMETRY_SCHEMA_VERSION = '1.1.0';

export type ChatEventName =
  | 'message_send'
  | 'message_retry'
  | 'wallet_connect'
  | 'bridge_open'
  | 'tx_confirm'
  | 'fiat_payout_step';

export interface ChatEvent<P extends object = Record<string, unknown>> {
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

/** Fiat payout modal funnel (BankDetailsModal). */
export type FiatPayoutTelemetryAction =
  | 'open'
  | 'close'
  | 'step_change'
  | 'bank_selected'
  | 'account_verify_success'
  | 'account_verify_fail'
  | 'confirm_attempt'
  | 'confirm_success'
  | 'confirm_error';

export interface FiatPayoutStepPayload {
  action: FiatPayoutTelemetryAction;
  step?: number;
  xlmAmount?: number;
  bankCode?: string;
  errorMessage?: string;
}

export interface AvatarColorTelemetryPayload {
  avatarBackgroundColor: string;
  avatarTextColor?: string;
}

export interface AccessibleAvatarColorTelemetryPayload
  extends AvatarColorTelemetryPayload {
  avatarTextColor: string;
  avatarContrastRatio: number;
  avatarContrastCompliant: boolean;
}

/**
 * Shared animation variants for telemetry chips/toasts in chat UI.
 * Keeping this in telemetry allows consumers to animate state changes
 * consistently when telemetry event status changes.
 */
export const telemetryMotionVariants: Variants = {
  hidden: { opacity: 0, y: 6, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

// ── Consent key ───────────────────────────────────────────────────────────

const CONSENT_KEY = 'nova_telemetry_consent';
const MIN_CONTRAST_RATIO = 4.5;
const FALLBACK_LIGHT_TEXT = '#FFFFFF';
const FALLBACK_DARK_TEXT = '#111827';

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();

  if (/^#[\da-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  if (/^#[\da-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

function getRelativeLuminance(color: string): number | null {
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) return null;

  const hex = normalizedColor.slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const sRGB = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : ((sRGB + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function calculateContrastRatio(
  foregroundColor: string,
  backgroundColor: string,
): number | null {
  const foregroundLuminance = getRelativeLuminance(foregroundColor);
  const backgroundLuminance = getRelativeLuminance(backgroundColor);

  if (
    foregroundLuminance === null ||
    backgroundLuminance === null
  ) {
    return null;
  }

  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return Number(ratio.toFixed(2));
}

export function getAccessibleAvatarTextColor(
  backgroundColor: string,
  preferredTextColor = FALLBACK_LIGHT_TEXT,
): string {
  const normalizedBackgroundColor = normalizeHexColor(backgroundColor);
  const normalizedPreferredTextColor =
    normalizeHexColor(preferredTextColor) ?? FALLBACK_LIGHT_TEXT;

  if (!normalizedBackgroundColor) {
    return normalizedPreferredTextColor;
  }

  const candidateColors = [
    normalizedPreferredTextColor,
    FALLBACK_LIGHT_TEXT,
    FALLBACK_DARK_TEXT,
  ].filter((color, index, allColors) => allColors.indexOf(color) === index);

  let bestColor = candidateColors[0];
  let bestRatio =
    calculateContrastRatio(bestColor, normalizedBackgroundColor) ?? 0;

  for (const candidateColor of candidateColors.slice(1)) {
    const candidateRatio =
      calculateContrastRatio(candidateColor, normalizedBackgroundColor) ?? 0;

    if (candidateRatio > bestRatio) {
      bestColor = candidateColor;
      bestRatio = candidateRatio;
    }
  }

  return bestRatio >= MIN_CONTRAST_RATIO ? bestColor : normalizedPreferredTextColor;
}

export function withAccessibleAvatarContrast<
  P extends object,
>(payload: P): P | (P & AccessibleAvatarColorTelemetryPayload) {
  const avatarPayload = payload as Partial<AvatarColorTelemetryPayload>;
  const backgroundColor =
    typeof avatarPayload.avatarBackgroundColor === 'string'
      ? normalizeHexColor(avatarPayload.avatarBackgroundColor)
      : null;

  // Fix rendering overflow: return original payload reference if no avatar colors
  if (!backgroundColor) {
    return payload;
  }

  const accessibleTextColor = getAccessibleAvatarTextColor(
    backgroundColor,
    typeof avatarPayload.avatarTextColor === 'string'
      ? avatarPayload.avatarTextColor
      : FALLBACK_LIGHT_TEXT,
  );
  const contrastRatio =
    calculateContrastRatio(accessibleTextColor, backgroundColor) ?? 0;

  // Fix rendering overflow: only create new object when avatar colors exist
  // This prevents unnecessary object creation and potential re-render cycles
  return {
    ...payload,
    avatarBackgroundColor: backgroundColor,
    avatarTextColor: accessibleTextColor,
    avatarContrastRatio: contrastRatio,
    avatarContrastCompliant: contrastRatio >= MIN_CONTRAST_RATIO,
  } as P & AccessibleAvatarColorTelemetryPayload;
}

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
 * 
 * Fix for rendering overflow: Uses requestAnimationFrame to defer event
 * dispatch and prevent blocking the main render cycle.
 */
function emit<P extends object>(
  name: ChatEventName,
  payload: P,
): void {
  if (!getTelemetryConsent()) return;

  const normalizedPayload =
    name === 'fiat_payout_step'
      ? payload
      : withAccessibleAvatarContrast(payload);

  const event: ChatEvent = {
    name,
    version: TELEMETRY_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: normalizedPayload,
  };

  // Fix rendering overflow: defer event dispatch to prevent blocking renders
  if (typeof window !== 'undefined') {
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent('chat:telemetry', { detail: event }),
      );
    });
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

  fiatPayoutStep(payload: FiatPayoutStepPayload): void {
    emit('fiat_payout_step', payload);
  },
};
