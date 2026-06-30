import { test, expect, Page } from '@playwright/test';
import { gotoChatConnected } from './helpers';

async function mockChatApi(page: Page): Promise<void> {
  await page.route('**/api/ai/chat**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intent: 'query',
        confidence: 0.95,
        extractedData: {},
        requiredQuestions: [],
        suggestedResponse: 'Queued message delivered after reconnect.',
        guardrail: {
          triggered: false,
          category: 'unsupported_request',
          reason: '',
        },
      }),
    });
  });
}

test.describe('Offline reconnect queue', () => {
  test('@slow connect -> offline send -> reconnect replays queued message', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP network emulation requires Chromium.');

    await mockChatApi(page);
    await gotoChatConnected(page);

    const messageInput = page.locator('[data-testid="chat-input-textarea"]');
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
    await expect(page.getByText('Back online. Replaying actions...')).toBeHidden({
      timeout: 15_000,
    });
  });
});
