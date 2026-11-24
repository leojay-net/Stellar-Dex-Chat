import { expect, Page } from '@playwright/test';
import { test } from './fixtures';
import { gotoChatConnected } from './helpers';

async function mockChatApi(
  page: Page,
  submittedMessages: string[],
): Promise<void> {
  await page.route('**/api/ai/chat**', async (route) => {
    submittedMessages.push(route.request().postDataJSON().message);
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

test.describe('Offline reconnect queue', { tag: '@chromium-only' }, () => {
  test('@slow connect -> offline send -> reconnect replays queued message', async ({
    page,
    context,
  }) => {
    const submittedMessages: string[] = [];
    await mockChatApi(page, submittedMessages);
    await gotoChatConnected(page);

    const messageInput = page.locator('[data-testid="chat-input-textarea"]');
    await expect(messageInput).toBeVisible({ timeout: 10_000 });

    const queuedMessage = 'check xlm market rates';
    await messageInput.fill(queuedMessage);
    await expect(messageInput).toBeFocused();

    const client = await context.newCDPSession(page);
    // Toggle connectivity events without interrupting Next.js asset loading.
    await client.send('Network.overrideNetworkState', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none',
    });

    await expect(
      page
        .getByRole('main')
        .getByText(
          'Offline detected. Read-only operations are queued and will retry when online.',
        ),
    ).toBeVisible({ timeout: 10_000 });

    const userMessage = page
      .getByRole('group', { name: 'Your message' })
      .getByText(queuedMessage, { exact: true });
    await page.keyboard.press('Control+Enter');
    await expect(
      page.getByRole('group', { name: 'Your message' }),
    ).toBeVisible();
    expect(submittedMessages).toEqual([]);

    await client.send('Network.overrideNetworkState', {
      offline: false,
      latency: 20,
      downloadThroughput: 5 * 1024 * 1024,
      uploadThroughput: 5 * 1024 * 1024,
      connectionType: 'wifi',
    });

    await expect(userMessage).toBeVisible();
    await expect(
      page
        .getByRole('group', { name: 'Assistant message' })
        .getByText('Queued message delivered after reconnect.'),
    ).toBeVisible();
    expect(submittedMessages).toEqual([queuedMessage]);
  });
});
