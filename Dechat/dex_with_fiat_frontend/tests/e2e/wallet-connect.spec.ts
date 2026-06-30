import { test, expect } from '@playwright/test';
import {
  connectMockWallet,
  gotoChatConnected,
  MOCK_WALLET_ADDRESS,
} from './helpers';

test.describe('Wallet Connect UI Path', () => {
  test('should display start bridging button on landing page', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: /start bridging/i }),
    ).toBeVisible();
  });

  test('should navigate to chat page and show wallet connection options', async ({
    page,
  }) => {
    await page.goto('/');
    await Promise.all([
      page.waitForURL('/chat'),
      page.getByRole('button', { name: /start bridging/i }).click(),
    ]);
    await expect(
      page.getByRole('button', { name: /connect freighter/i }),
    ).toBeVisible();
  });

  test('should connect wallet via E2E hook and show address', async ({ page }) => {
    await gotoChatConnected(page);
    await expect(
      page.getByText(new RegExp(MOCK_WALLET_ADDRESS.slice(0, 6), 'i')),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Disconnect wallet' }),
    ).toBeVisible();
  });

  test('should handle wallet disconnection', async ({ page }) => {
    await gotoChatConnected(page);
    await page.getByRole('button', { name: 'Disconnect wallet' }).click();
    await expect(
      page.getByRole('button', { name: /connect freighter/i }),
    ).toBeVisible();
  });

  test('should keep connect option available before wallet is connected', async ({
    page,
  }) => {
    await page.goto('/chat');
    await expect(
      page.getByRole('button', { name: /connect freighter/i }),
    ).toBeVisible();
  });
});
