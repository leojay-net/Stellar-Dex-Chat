'use client';

import { useEffect, useState } from 'react';
import {
  calculateContrastRatio,
  chatTelemetry,
  getAccessibleAvatarTextColor,
  getTelemetryConsent,
  getTelemetryMotionVariants,
  setTelemetryConsent,
  telemetryEventMotionIntent,
} from '@/lib/chatTelemetry';

/**
 * Deterministic telemetry calls, one per button. Each fixture mirrors a real
 * call site's payload shape so E2E tests can assert on the dispatched
 * `chat:telemetry` CustomEvent.
 */
const SCENARIOS: { id: string; label: string; run: () => void }[] = [
  {
    id: 'message-send-short',
    label: 'messageSend (10 chars, no wallet)',
    run: () => chatTelemetry.messageSend({ messageLength: 10, hasWallet: false }),
  },
  {
    id: 'message-send',
    label: 'messageSend (25 chars, wallet)',
    run: () => chatTelemetry.messageSend({ messageLength: 25, hasWallet: true }),
  },
  {
    id: 'message-retry',
    label: 'messageRetry',
    run: () =>
      chatTelemetry.messageRetry({
        retryAttempts: 3,
        errorMessage: 'Network timeout',
      }),
  },
  {
    id: 'wallet-connect',
    label: 'walletConnect',
    run: () =>
      chatTelemetry.walletConnect({ walletType: 'freighter', success: true }),
  },
  {
    id: 'bridge-open',
    label: 'bridgeOpen (deposit, then withdraw)',
    run: () => {
      chatTelemetry.bridgeOpen({ flow: 'deposit' });
      chatTelemetry.bridgeOpen({ flow: 'withdraw' });
    },
  },
  {
    id: 'tx-confirm',
    label: 'txConfirm',
    run: () =>
      chatTelemetry.txConfirm({
        assetCode: 'XLM',
        amountXlm: 150.5,
        network: 'TESTNET',
      }),
  },
  {
    id: 'fiat-payout-step',
    label: 'fiatPayoutStep',
    run: () =>
      chatTelemetry.fiatPayoutStep({
        action: 'step_change',
        step: 2,
        xlmAmount: 500,
        bankCode: '058',
      }),
  },
  {
    id: 'payment-status',
    label: 'paymentStatus',
    run: () =>
      chatTelemetry.paymentStatus({
        status: 'success',
        reference: 'PAY_123456',
        hasAmount: true,
        hasFailureReason: false,
      }),
  },
  {
    id: 'network-status',
    label: 'networkStatus',
    run: () =>
      chatTelemetry.networkStatus({ status: 'offline', source: 'browser-event' }),
  },
  {
    id: 'split-view',
    label: 'splitView',
    run: () =>
      chatTelemetry.splitView({
        action: 'swap_sessions',
        leftSessionId: 'sess-2',
        rightSessionId: 'sess-1',
      }),
  },
  {
    id: 'avatar-color-check',
    label: 'avatarColorCheck (#000000)',
    run: () => chatTelemetry.avatarColorCheck({ avatarBackgroundColor: '#000000' }),
  },
];

/** Results of the pure accessibility / motion helpers, rendered as JSON. */
function computeUtilityResults() {
  return {
    contrast: {
      whiteOnBlack: calculateContrastRatio('#FFFFFF', '#000000'),
      blackOnWhite: calculateContrastRatio('#000000', '#FFFFFF'),
      accessibleTextForLightBg: getAccessibleAvatarTextColor('#F3F4F6'),
      accessibleTextForDarkBg: getAccessibleAvatarTextColor('#1E293B'),
    },
    motionIntents: {
      retry: telemetryEventMotionIntent('message_retry'),
      avatar: telemetryEventMotionIntent('avatar_color_check'),
      tx: telemetryEventMotionIntent('tx_confirm'),
      send: telemetryEventMotionIntent('message_send'),
    },
    reducedMotionVariants: getTelemetryMotionVariants({ reducedMotion: true }),
  };
}

/**
 * Test harness page for chatTelemetry E2E tests.
 *
 * Buttons toggle consent and emit telemetry events; tests observe the
 * `chat:telemetry` CustomEvents dispatched on window. The pure helper results
 * are rendered into the page so they can be asserted without importing app
 * modules into the browser.
 */
export default function TestChatTelemetryPage() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [utilityResults, setUtilityResults] = useState<ReturnType<
    typeof computeUtilityResults
  > | null>(null);

  useEffect(() => {
    setConsent(getTelemetryConsent());
    setUtilityResults(computeUtilityResults());
  }, []);

  const updateConsent = (enabled: boolean) => {
    setTelemetryConsent(enabled);
    setConsent(getTelemetryConsent());
  };

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">chatTelemetry Test Harness</h1>

      <section aria-label="Consent" className="flex items-center gap-3">
        <p data-testid="consent-state" className="text-sm">
          {consent === null ? 'loading' : consent ? 'granted' : 'denied'}
        </p>
        <button
          type="button"
          data-testid="grant-consent"
          onClick={() => updateConsent(true)}
          className="px-3 py-1 text-sm rounded border"
        >
          Grant consent
        </button>
        <button
          type="button"
          data-testid="revoke-consent"
          onClick={() => updateConsent(false)}
          className="px-3 py-1 text-sm rounded border"
        >
          Revoke consent
        </button>
      </section>

      <section aria-label="Emit events" className="flex flex-wrap gap-2">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            data-testid={`emit-${scenario.id}`}
            onClick={scenario.run}
            className="px-3 py-1 text-sm rounded border"
          >
            {scenario.label}
          </button>
        ))}
      </section>

      <pre data-testid="utility-results" className="text-xs whitespace-pre-wrap">
        {utilityResults ? JSON.stringify(utilityResults) : ''}
      </pre>
    </main>
  );
}
