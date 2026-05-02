import { test, expect, Page } from '@playwright/test';

const MOCK_CHAT_REPLY = 'Queued message delivered after reconnect.';

async function mockGeminiResponse(page: Page): Promise<void> {
  await page.route('**/v1beta/models/**:generateContent*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'query',
                    confidence: 0.95,
                    extractedData: {},
                    requiredQuestions: [],
                    suggestedResponse: MOCK_CHAT_REPLY,
                    guardrail: {
                      triggered: false,
                      category: 'unsupported_request',
                      reason: '',
                    },
                  }),
                },
              ],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      }),
    });
  });
}

test.describe('Offline reconnect queue', () => {
  test('@slow connect -> offline send -> reconnect replays queued message', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP network emulation requires Chromium.');

    await mockGeminiResponse(page);
    await page.goto('/chat');

    await page.evaluate(() => {
      (window as { mockStellarConnect?: (address: string) => void }).mockStellarConnect?.(
        'GD5DJQD7KGYRY4TSK4K2V5J2D2J2XQK2T2D2J2XQK2T2D2J2XQK2T2D2J2XQK2T2D2J2XQK2',
      );
    });

    const messageInput = page.locator('textarea').first();
    await expect(messageInput).toBeVisible({ timeout: 10_000 });

    const queuedMessage = 'check xlm market rates';
    await messageInput.fill(queuedMessage);

    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none',
    });

    await messageInput.press('Enter');

    await expect(
      page.getByText(
        'Offline detected. Read-only operations are queued and will retry when online.',
      ),
    ).toBeVisible({ timeout: 10_000 });

    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 20,
      downloadThroughput: 5 * 1024 * 1024,
      uploadThroughput: 5 * 1024 * 1024,
      connectionType: 'wifi',
    });

    await expect(page.getByText('Back online. Replaying actions...')).toBeVisible({
      timeout: 10_000,
    });

    await expect(page.getByText(queuedMessage)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(MOCK_CHAT_REPLY)).toBeVisible({ timeout: 10_000 });
  });
});
