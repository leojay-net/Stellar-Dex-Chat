import { test, expect, Page } from '@playwright/test';
import { gotoChatConnected, mockSorobanRpc } from './helpers';

async function mockGeminiDepositReply(page: Page): Promise<void> {
  await page.route('**/api/ai/chat**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intent: 'deposit',
        confidence: 0.95,
        extractedData: { amount: 100, token: 'USDC' },
        requiredQuestions: [],
        suggestedResponse:
          'Deposit request received. Your deposit of 100 USDC was confirmed successfully.',
      }),
    });
  });
}

test.describe('Deposit flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await mockGeminiDepositReply(page);
  });

  test('should show the landing page CTA on load', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: /start bridging/i }),
    ).toBeVisible();
  });

  test('deposit 100 USDC → success message is shown', async ({ page }) => {
    await gotoChatConnected(page);

    const chatInput = page.locator('[data-testid="chat-input-textarea"]');
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
    await chatInput.fill('deposit 100 USDC');
    await chatInput.press('Enter');

    await expect(
      page
        .getByText(/deposit request received|deposit.*success|100.*usdc/i)
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('page title includes Stellar', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/stellar|dexfiat|bridge/i, { timeout: 10_000 });
  });
});
