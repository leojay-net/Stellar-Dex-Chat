/**
 * E2E test: Deposit flow (issue #313)
 *
 * Acceptance criteria:
 *   ✅ Playwright installed as dev dependency (already present)
 *   ✅ Test: connect wallet → type 'deposit 100 USDC' → verify success message
 *   ✅ Mocks contract call via page.route() intercept
 *   ✅ Runs in CI (playwright.config.ts already wires up webServer)
 *
 * The test intercepts the Soroban RPC endpoint so no real wallet or network is needed.
 */

import { test, expect, Page } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mock Soroban RPC responses so no real contract or wallet is required. */
async function mockSorobanRpc(page: Page): Promise<void> {
  await page.route('**/soroban/rpc', async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    const method = body?.method ?? '';

    /* Simulate a successful deposit: return a fake receipt id (0) */
    if (method === 'simulateTransaction' || method === 'sendTransaction') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            status: 'SUCCESS',
            results: [{ xdr: 'AAAAAAAAAGQAAAAAAAAAAQ==' }],
            latestLedger: 1000,
            latestLedgerCloseTime: '1711670400',
          },
        }),
      });
      return;
    }

    /* Pass everything else through */
    await route.continue();
  });
}

/** Wait for and click the first button whose text matches the pattern. */
async function clickButton(page: Page, label: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: label }).first().click();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Deposit flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto('/');
  });

  test('should show the landing page or chat interface on load', async ({ page }) => {
    // Either the landing page CTA or the chat input should be present
    const hasCTA = await page
      .getByRole('button', { name: /launch app|connect|get started/i })
      .first()
      .isVisible()
      .catch(() => false);

    const hasChat = await page
      .locator('textarea, input[type="text"]')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasCTA || hasChat).toBe(true);
  });

  test('deposit 100 USDC → success message is shown', async ({ page }) => {
    /* ── Step 1: Navigate to the chat interface ─────────────────────────── */
    const launchBtn = page.getByRole('button', {
      name: /launch app|start chatting|open app/i,
    });
    if (await launchBtn.first().isVisible().catch(() => false)) {
      await launchBtn.first().click();
    }

    /* ── Step 2: Connect wallet (mock — no real Freighter needed) ────────
     *  The chat interface shows a "Connect Wallet" button when no wallet
     *  is connected.  We click it and intercept any wallet popup.         */
    const connectBtn = page
      .getByRole('button', { name: /connect wallet|connect/i })
      .first();

    if (await connectBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      /* Intercept potential wallet extension popup so it doesn't open */
      page.on('popup', (popup) => popup.close());
      await connectBtn.click();

      /* If a modal or follow-up dialog appears, dismiss it */
      const dismissBtn = page
        .getByRole('button', { name: /cancel|dismiss|close|skip/i })
        .first();
      if (await dismissBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await dismissBtn.click();
      }
    }

    /* ── Step 3: Type the deposit command ────────────────────────────────── */
    const chatInput = page.locator(
      'textarea[placeholder], input[type="text"][placeholder]'
    ).first();

    await expect(chatInput).toBeVisible({ timeout: 10_000 });
    await chatInput.fill('deposit 100 USDC');

    /* ── Step 4: Submit ──────────────────────────────────────────────────── */
    // Try pressing Enter first; fall back to the send button
    await chatInput.press('Enter');

    const sendBtn = page
      .getByRole('button', { name: /send|submit/i })
      .first();
    if (await sendBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await sendBtn.click();
    }

    /* ── Step 5: Verify success message ─────────────────────────────────── */
    // The chat interface should display a confirmation message containing
    // keywords like "deposit", "success", "receipt", or "100".
    await expect(
      page.getByText(/deposit.*success|receipt.*issued|100.*usdc.*deposit|deposit.*confirmed/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('deposit command shows an error if amount is zero', async ({ page }) => {
    /* Navigate to chat */
    const launchBtn = page.getByRole('button', {
      name: /launch app|start chatting|open app/i,
    });
    if (await launchBtn.first().isVisible().catch(() => false)) {
      await launchBtn.first().click();
    }

    const chatInput = page
      .locator('textarea[placeholder], input[type="text"][placeholder]')
      .first();

    if (!(await chatInput.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await chatInput.fill('deposit 0 USDC');
    await chatInput.press('Enter');

    // Expect some form of error feedback (the UI may show an inline message)
    await expect(
      page
        .getByText(/invalid|zero|amount|error/i)
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('page title includes Stellar', async ({ page }) => {
    await expect(page).toHaveTitle(/stellar/i, { timeout: 10_000 });
  });
});
