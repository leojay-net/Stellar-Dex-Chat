'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  chatTelemetry,
  getTelemetryConsent,
  setTelemetryConsent,
  type MessageSendPayload,
  type MessageRetryPayload,
  type WalletConnectPayload,
  type BridgeOpenPayload,
  type TxConfirmPayload,
  type FiatPayoutStepPayload,
} from '@/lib/chatTelemetry';

/**
 * Hook that exposes telemetry event emitters and a consent toggle.
 * All emitters are no-ops when the user has not granted consent.
 */
export function useChatTelemetry() {
  const [consented, setConsented] = useState(false);

  // Hydrate consent state after mount (avoids SSR mismatch)
  useEffect(() => {
    setConsented(getTelemetryConsent());
  }, []);

  const updateConsent = useCallback((enabled: boolean) => {
    setTelemetryConsent(enabled);
    setConsented(enabled);
  }, []);

  const trackMessageSend = useCallback((payload: MessageSendPayload) => {
    chatTelemetry.messageSend(payload);
  }, []);

  const trackMessageRetry = useCallback((payload: MessageRetryPayload) => {
    chatTelemetry.messageRetry(payload);
  }, []);

  const trackWalletConnect = useCallback((payload: WalletConnectPayload) => {
    chatTelemetry.walletConnect(payload);
  }, []);

  const trackBridgeOpen = useCallback((payload: BridgeOpenPayload) => {
    chatTelemetry.bridgeOpen(payload);
  }, []);

  const trackTxConfirm = useCallback((payload: TxConfirmPayload) => {
    chatTelemetry.txConfirm(payload);
  }, []);

  const trackFiatPayoutStep = useCallback((payload: FiatPayoutStepPayload) => {
    chatTelemetry.fiatPayoutStep(payload);
  }, []);

  return {
    /** Whether the user has granted analytics consent. */
    consented,
    /** Enable or disable telemetry. */
    setConsent: updateConsent,
    trackMessageSend,
    trackMessageRetry,
    trackWalletConnect,
    trackBridgeOpen,
    trackTxConfirm,
    trackFiatPayoutStep,
  };
}
