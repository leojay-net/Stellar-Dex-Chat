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

const TEST_URL = '/';

/** Setup a listener on the window to collect telemetry events in the browser */
async function attachTelemetryCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
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

test.describe('chatTelemetry E2E Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await page.waitForLoadState('domcontentloaded');
    await attachTelemetryCollector(page);
  });

  test.describe('Consent Management & Event Suppression', () => {
    test('suppresses telemetry events when consent is not granted', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry, setTelemetryConsent } = await import('@/lib/chatTelemetry');
        setTelemetryConsent(false);
        chatTelemetry.messageSend({ messageLength: 10, hasWallet: false });
      });

      // Wait a frame for any rAF
      await page.waitForTimeout(50);
      const events = await getCollectedEvents(page);
      expect(events.length).toBe(0);
    });

    test('emits telemetry events when consent is granted', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry, setTelemetryConsent } = await import('@/lib/chatTelemetry');
        setTelemetryConsent(true);
        chatTelemetry.messageSend({ messageLength: 25, hasWallet: true });
      });

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
      await page.evaluate(async () => {
        const { chatTelemetry, setTelemetryConsent } = await import('@/lib/chatTelemetry');
        setTelemetryConsent(true);
        chatTelemetry.messageSend({ messageLength: 15, hasWallet: true });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      await clearCollectedEvents(page);

      await page.evaluate(async () => {
        const { chatTelemetry, setTelemetryConsent } = await import('@/lib/chatTelemetry');
        setTelemetryConsent(false);
        chatTelemetry.messageSend({ messageLength: 30, hasWallet: false });
      });

      await page.waitForTimeout(50);
      const events = await getCollectedEvents(page);
      expect(events.length).toBe(0);
    });
  });

  test.describe('Event Types & Schema Validation', () => {
    test.beforeEach(async ({ page }) => {
      await page.evaluate(async () => {
        const { setTelemetryConsent } = await import('@/lib/chatTelemetry');
        setTelemetryConsent(true);
      });
    });

    test('emits messageRetry event with correct payload', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.messageRetry({ retryAttempts: 3, errorMessage: 'Network timeout' });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('message_retry');
      expect(event.payload.retryAttempts).toBe(3);
      expect(event.payload.errorMessage).toBe('Network timeout');
    });

    test('emits walletConnect event with correct payload', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.walletConnect({ walletType: 'freighter', success: true });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('wallet_connect');
      expect(event.payload.walletType).toBe('freighter');
      expect(event.payload.success).toBe(true);
    });

    test('emits bridgeOpen event for deposit and withdraw flows', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.bridgeOpen({ flow: 'deposit' });
        chatTelemetry.bridgeOpen({ flow: 'withdraw' });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 2);
      const events = await getCollectedEvents(page);
      expect(events[0].name).toBe('bridge_open');
      expect(events[0].payload.flow).toBe('deposit');
      expect(events[1].name).toBe('bridge_open');
      expect(events[1].payload.flow).toBe('withdraw');
    });

    test('emits txConfirm event with asset and network details', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.txConfirm({
          assetCode: 'XLM',
          amountXlm: 150.5,
          network: 'TESTNET',
        });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('tx_confirm');
      expect(event.payload.assetCode).toBe('XLM');
      expect(event.payload.amountXlm).toBe(150.5);
      expect(event.payload.network).toBe('TESTNET');
    });

    test('emits fiatPayoutStep event with funnel actions', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.fiatPayoutStep({
          action: 'step_change',
          step: 2,
          xlmAmount: 500,
          bankCode: '058',
        });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('fiat_payout_step');
      expect(event.payload.action).toBe('step_change');
      expect(event.payload.step).toBe(2);
      expect(event.payload.xlmAmount).toBe(500);
      expect(event.payload.bankCode).toBe('058');
    });

    test('emits paymentStatus event with reference and state', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.paymentStatus({
          status: 'success',
          reference: 'PAY_123456',
          hasAmount: true,
          hasFailureReason: false,
        });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('payment_status');
      expect(event.payload.status).toBe('success');
      expect(event.payload.reference).toBe('PAY_123456');
      expect(event.payload.hasAmount).toBe(true);
      expect(event.payload.hasFailureReason).toBe(false);
    });

    test('emits networkStatus event on connectivity transitions', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.networkStatus({
          status: 'offline',
          source: 'browser-event',
        });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('network_status');
      expect(event.payload.status).toBe('offline');
      expect(event.payload.source).toBe('browser-event');
    });

    test('emits splitView event on thread comparisons', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.splitView({
          action: 'swap_sessions',
          leftSessionId: 'sess-2',
          rightSessionId: 'sess-1',
        });
      });

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
      await page.evaluate(async () => {
        const { setTelemetryConsent } = await import('@/lib/chatTelemetry');
        setTelemetryConsent(true);
      });
    });

    test('avatarColorCheck emits event with enriched contrast calculations', async ({ page }) => {
      await page.evaluate(async () => {
        const { chatTelemetry } = await import('@/lib/chatTelemetry');
        chatTelemetry.avatarColorCheck({
          avatarBackgroundColor: '#000000',
        });
      });

      await page.waitForFunction(() => (window as any).__collectedTelemetryEvents.length === 1);
      const [event] = await getCollectedEvents(page);
      expect(event.name).toBe('avatar_color_check');
      expect(event.payload.avatarBackgroundColor).toBe('#000000');
      expect(event.payload.avatarTextColor).toBe('#FFFFFF');
      expect(event.payload.avatarContrastCompliant).toBe(true);
      expect(event.payload.avatarContrastRatio).toBeGreaterThanOrEqual(4.5);
    });

    test('calculateContrastRatio computes WCAG luminance ratios in browser', async ({ page }) => {
      const results = await page.evaluate(async () => {
        const { calculateContrastRatio, getAccessibleAvatarTextColor } = await import(
          '@/lib/chatTelemetry'
        );
        const whiteOnBlack = calculateContrastRatio('#FFFFFF', '#000000');
        const blackOnWhite = calculateContrastRatio('#000000', '#FFFFFF');
        const accessibleTextForLightBg = getAccessibleAvatarTextColor('#F3F4F6');
        const accessibleTextForDarkBg = getAccessibleAvatarTextColor('#1E293B');

        return {
          whiteOnBlack,
          blackOnWhite,
          accessibleTextForLightBg,
          accessibleTextForDarkBg,
        };
      });

      expect(results.whiteOnBlack).toBe(21);
      expect(results.blackOnWhite).toBe(21);
      expect(results.accessibleTextForLightBg).toBe('#111827');
      expect(results.accessibleTextForDarkBg).toBe('#FFFFFF');
    });
  });

  test.describe('Motion Variants & Reduced Motion', () => {
    test('resolves telemetry motion intents correctly', async ({ page }) => {
      const intents = await page.evaluate(async () => {
        const { telemetryEventMotionIntent } = await import('@/lib/chatTelemetry');
        return {
          retry: telemetryEventMotionIntent('message_retry'),
          avatar: telemetryEventMotionIntent('avatar_color_check'),
          tx: telemetryEventMotionIntent('tx_confirm'),
          send: telemetryEventMotionIntent('message_send'),
        };
      });

      expect(intents.retry).toBe('error');
      expect(intents.avatar).toBe('warning');
      expect(intents.tx).toBe('success');
      expect(intents.send).toBe('info');
    });

    test('returns reduced motion variants when requested', async ({ page }) => {
      const variants = await page.evaluate(async () => {
        const { getTelemetryMotionVariants } = await import('@/lib/chatTelemetry');
        return getTelemetryMotionVariants({ reducedMotion: true });
      });

      expect(variants.hidden.opacity).toBe(0);
      expect(variants.hidden.y).toBeUndefined();
      expect(variants.visible.opacity).toBe(1);
    });
  });
});
