import { expect, test, type Page } from '@playwright/test';

const CHAT_HISTORY_KEY = 'defi_chat_history';

async function stubContractEvents(page: Page) {
  await page.route('**/api/events?limit=5', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [] }),
    });
  });
}

async function seedChatHistory(page: Page) {
  const now = new Date('2026-08-27T12:00:00.000Z').toISOString();

  await page.addInitScript(
    ({ key, timestamp }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          currentSessionId: 'session-pinned',
          sessions: [
            {
              id: 'session-pinned',
              title: 'Pinned USDC route',
              messages: [
                {
                  id: 'message-1',
                  role: 'user',
                  content: 'Swap USDC to XLM',
                  timestamp,
                },
                {
                  id: 'message-2',
                  role: 'assistant',
                  content: 'Here is the best route for that swap.',
                  timestamp,
                },
              ],
              createdAt: timestamp,
              lastUpdated: timestamp,
              walletAddress:
                'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
              pinned: true,
              pinnedAt: timestamp,
            },
            {
              id: 'session-recent',
              title: 'Bridge payout status',
              messages: [
                {
                  id: 'message-3',
                  role: 'user',
                  content: 'Check my payout',
                  timestamp,
                },
              ],
              createdAt: timestamp,
              lastUpdated: timestamp,
            },
          ],
        }),
      );
    },
    { key: CHAT_HISTORY_KEY, timestamp: now },
  );
}

async function openExpandedHistory(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/chat');
  await page.locator('header button').first().click();
  await expect(page.getByPlaceholder('Search conversations...')).toBeVisible({
    timeout: 5_000,
  });
}

test.describe('ChatHistorySidebar', () => {
  test('shows the empty history and contract activity states', async ({ page }) => {
    await stubContractEvents(page);
    await openExpandedHistory(page);

    await expect(page.getByText('No conversations yet')).toBeVisible();
    await expect(page.getByText('No recent bridge activity')).toBeVisible();
    await expect(page.getByTitle('New Conversation')).toBeVisible();
  });

  test('renders pinned and recent sessions from local storage', async ({ page }) => {
    await seedChatHistory(page);
    await stubContractEvents(page);
    await openExpandedHistory(page);

    await expect(page.getByText('Pinned')).toBeVisible();
    await expect(page.getByText('Recent')).toBeVisible();
    await expect(page.getByText('Pinned USDC route')).toBeVisible();
    await expect(page.getByText('Bridge payout status')).toBeVisible();
    await expect(page.locator('[data-active="true"]')).toContainText(
      'Pinned USDC route',
    );
  });

  test('filters sessions and clears an empty search result', async ({ page }) => {
    await seedChatHistory(page);
    await stubContractEvents(page);
    await openExpandedHistory(page);

    const search = page.getByPlaceholder('Search conversations...');
    await search.fill('bridge');
    await expect(page.getByText('Bridge payout status')).toBeVisible();
    await expect(page.getByText('Pinned USDC route')).toBeHidden();

    await search.fill('missing conversation');
    await expect(page.getByText('No conversations found')).toBeVisible();
    await page.getByText('Clear search').click();
    await expect(search).toHaveValue('');
  });

  test('exposes row actions for pinned conversations', async ({ page }) => {
    await seedChatHistory(page);
    await stubContractEvents(page);
    await openExpandedHistory(page);

    await page.getByText('Pinned USDC route').hover();

    await expect(page.getByTitle('Unpin conversation')).toBeVisible();
    await expect(page.getByTitle('Export conversation')).toBeVisible();
    await expect(page.getByTitle('Delete conversation')).toBeVisible();
    await expect(page.getByLabel('Reorder pinned down')).toBeVisible();
  });

  test('keeps saved history visible when contract activity fails to load', async ({
    page,
  }) => {
    await seedChatHistory(page);
    await page.route('**/api/events?limit=5', async (route) => route.abort());
    await openExpandedHistory(page);

    await expect(page.getByText('Pinned USDC route')).toBeVisible();
    await expect(page.getByText('No recent bridge activity')).toBeVisible();
  });
});