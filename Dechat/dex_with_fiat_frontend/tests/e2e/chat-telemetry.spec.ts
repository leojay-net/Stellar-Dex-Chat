import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for chatTelemetry.ts
 *
 * Verifies:
 * 1. Consent gating (suppressed when false, emitted when true)
 * 2. Event dispatching via CustomEvent ('chat:telemetry')
 * 3. All event types (messageSend, messageRetry, walletConnect, bridgeOpen, txConfirm,
 *    fiatPayoutStep, paymentStatus, networkStatus, splitView, avatarColorCheck)
 * 4. Avatar WCAG contrast enrichment
 * 5. Motion variants and reduced-motion adaptation
 * 6. Non-blocking resilient dispatching
 */

/**
 * Uses the /test-chat-telemetry harness page, whose buttons toggle consent and
 * call the real chatTelemetry API with fixed payloads. Events are observed via
 * the `chat:telemetry` CustomEvent the module dispatches on window; pure helper
 * results are read from the harness DOM. (App modules cannot be imported
 * inside page.evaluate — the browser cannot resolve `@/` specifiers.)
 */
const TEST_URL = '/test-chat-telemetry';

/** Install a window listener, before any app code runs, that collects telemetry events. */
async function attachTelemetryCollector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__collectedTelemetryEvents = [];
    window.addEventListener('chat:telemetry', (e: any) => {
      (window as any).__collectedTelemetryEvents.push(e.detail);
    });
  });
}

/** Get collected telemetry events from window */
async function getCollectedEvents(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__collectedTelemetryEvents || []);
}

/** Clear collected events */
async function clearCollectedEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__collectedTelemetryEvents = [];
  });
}

/**
 * Wait for two animation frames. emit() defers dispatch to
 * requestAnimationFrame, so anything emitted before this call has either been
 * dispatched or suppressed by the time it resolves.
 */
async function flushAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function setConsent(page: Page, enabled: boolean): Promise<void> {
  await page.getByTestId(enabled ? 'grant-consent' : 'revoke-consent').click();
  await expect(page.getByTestId('consent-state')).toHaveText(
    enabled ? 'granted' : 'denied',
  );
}

/** Click the harness button that emits the given telemetry scenario. */
async function emitScenario(page: Page, id: string): Promise<void> {
  await page.getByTestId(`emit-${id}`).click();
}

/** Parsed results of the pure helpers rendered by the harness. */
async function getUtilityResults(page: Page): Promise<any> {
  const results = page.getByTestId('utility-results');
  await expect(results).not.toBeEmpty();
  return JSON.parse((await results.textContent()) ?? '{}');
}

test.describe('chatTelemetry E2E Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await attachTelemetryCollector(page);
    await page.goto(TEST_URL);
    await page.waitForLoadState('domcontentloaded');
    // Consent state is read on mount, so this also waits for hydration.
    await expect(page.getByTestId('consent-state')).not.toHaveText('loading');
  });

  test.describe('Consent Management & Event Suppression', () => {
    test('suppresses telemetry events when consent is not granted', async ({ page }) => {
      await setConsent(page, false);
      await emitScenario(page, 'message-send-short');

      // Wait for the deferred (rAF) dispatch window to pass
      await flushAnimationFrames(page);
      const events = await getCollectedEvents(page);
      expect(events.length).toBe(0);
    });

    test('emits telemetry events when consent is granted', async ({ page }) => {
      await setConsent(page, true);
      await emitScenario(page, 'message-send');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const events = await getCollectedEvents(page);
      expect(events.length).toBe(1);
      expect(events[0].name).toBe('message_send');
      expect(events[0].version).toBe('1.1.0');
      expect(events[0].payload.messageLength).toBe(25);
      expect(events[0].payload.hasWallet).toBe(true);
      expect(typeof events[0].timestamp).toBe('number');
    });

    test('immediately stops emitting events when consent is revoked', async ({ page }) => {
      await setConsent(page, true);
      await emitScenario(page, 'message-send');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      await clearCollectedEvents(page);

      await setConsent(page, false);
      await emitScenario(page, 'message-send-short');

      await flushAnimationFrames(page);
      const events = await getCollectedEvents(page);
      expect(events.length).toBe(0);
    });
  });

  test.describe('Event Types & Schema Validation', () => {
    test.beforeEach(async ({ page }) => {
      await setConsent(page, true);
    });

    test('emits messageRetry event with correct payload', async ({ page }) => {
      await emitScenario(page, 'message-retry');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('message_retry');
      expect(event.payload.retryAttempts).toBe(3);
      expect(event.payload.errorMessage).toBe('Network timeout');
    });

    test('emits walletConnect event with correct payload', async ({ page }) => {
      await emitScenario(page, 'wallet-connect');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('wallet_connect');
      expect(event.payload.walletType).toBe('freighter');
      expect(event.payload.success).toBe(true);
    });

    test('emits bridgeOpen event for deposit and withdraw flows', async ({ page }) => {
      await emitScenario(page, 'bridge-open');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 2);
      const events = await getCollectedEvents(page);
      expect(events[0].name).toBe('bridge_open');
      expect(events[0].payload.flow).toBe('deposit');
      expect(events[1].name).toBe('bridge_open');
      expect(events[1].payload.flow).toBe('withdraw');
    });

    test('emits txConfirm event with asset and network details', async ({ page }) => {
      await emitScenario(page, 'tx-confirm');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('tx_confirm');
      expect(event.payload.assetCode).toBe('XLM');
      expect(event.payload.amountXlm).toBe(150.5);
      expect(event.payload.network).toBe('TESTNET');
    });

    test('emits fiatPayoutStep event with funnel actions', async ({ page }) => {
      await emitScenario(page, 'fiat-payout-step');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('fiat_payout_step');
      expect(event.payload.action).toBe('step_change');
      expect(event.payload.step).toBe(2);
      expect(event.payload.xlmAmount).toBe(500);
      expect(event.payload.bankCode).toBe('058');
    });

    test('emits paymentStatus event with reference and state', async ({ page }) => {
      await emitScenario(page, 'payment-status');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('payment_status');
      expect(event.payload.status).toBe('success');
      expect(event.payload.reference).toBe('PAY_123456');
      expect(event.payload.hasAmount).toBe(true);
      expect(event.payload.hasFailureReason).toBe(false);
    });

    test('emits networkStatus event on connectivity transitions', async ({ page }) => {
      await emitScenario(page, 'network-status');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('network_status');
      expect(event.payload.status).toBe('offline');
      expect(event.payload.source).toBe('browser-event');
    });

    test('emits splitView event on thread comparisons', async ({ page }) => {
      await emitScenario(page, 'split-view');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('split_view');
      expect(event.payload.action).toBe('swap_sessions');
      expect(event.payload.leftSessionId).toBe('sess-2');
      expect(event.payload.rightSessionId).toBe('sess-1');
    });
  });

  test.describe('Avatar Contrast & Accessibility Utilities', () => {
    test.beforeEach(async ({ page }) => {
      await setConsent(page, true);
    });

    test('avatarColorCheck emits event with enriched contrast calculations', async ({ page }) => {
      await emitScenario(page, 'avatar-color-check');

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('avatar_color_check');
      expect(event.payload.avatarBackgroundColor).toBe('#000000');
      expect(event.payload.avatarTextColor).toBe('#FFFFFF');
      expect(event.payload.avatarContrastCompliant).toBe(true);
      expect(event.payload.avatarContrastRatio).toBeGreaterThanOrEqual(4.5);
    });

    test('calculateContrastRatio computes WCAG luminance ratios in browser', async ({ page }) => {
      const results = (await getUtilityResults(page)).contrast;

      expect(results.whiteOnBlack).toBe(21);
      expect(results.blackOnWhite).toBe(21);
      expect(results.accessibleTextForLightBg).toBe('#111827');
      expect(results.accessibleTextForDarkBg).toBe('#FFFFFF');
    });
  });

  test.describe('Motion Variants & Reduced Motion', () => {
    test('resolves telemetry motion intents correctly', async ({ page }) => {
      const intents = (await getUtilityResults(page)).motionIntents;

      expect(intents.retry).toBe('error');
      expect(intents.avatar).toBe('warning');
      expect(intents.tx).toBe('success');
      expect(intents.send).toBe('info');
    });

    test('returns reduced motion variants when requested', async ({ page }) => {
      const variants = (await getUtilityResults(page)).reducedMotionVariants;

      expect(variants.hidden.opacity).toBe(0);
      expect(variants.hidden.y).toBeUndefined();
      expect(variants.visible.opacity).toBe(1);
    });
  });
});
