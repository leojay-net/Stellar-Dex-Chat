import { test, expect } from '@playwright/test';

test.describe('Message component E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-message');
  });

  test.describe('Markdown rendering', () => {
    test('renders markdown link and opens in new tab', async ({ page }) => {
      const anchor = page.locator('a', { hasText: 'link' }).first();
      await expect(anchor).toBeVisible();
      await expect(anchor).toHaveAttribute('href', 'https://example.com');
      await expect(anchor).toHaveAttribute('target', '_blank');
    });

    test('renders bold and italic text', async ({ page }) => {
      await expect(page.locator('strong').first()).toBeVisible();
      await expect(page.locator('em').first()).toBeVisible();
    });

    test('renders code blocks', async ({ page }) => {
      await expect(page.locator('code').first()).toBeVisible();
    });
  });

  test.describe('Transaction details', () => {
    test('shows transaction details and copy buttons', async ({ page }) => {
      await expect(page.getByText(/Transaction Details/i)).toBeVisible();
      await expect(page.getByText(/Receipt ID:/i)).toBeVisible();
    });

    test('copies transaction hash on button click', async ({
      page,
      context,
      browserName,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'Clipboard permissions are only supported in Chromium.',
      );

      const copyButton = page.locator('button[aria-label*="copy" i]').first();
      await expect(copyButton).toBeVisible();
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await copyButton.click();
    });
  });

  test.describe('Suggested actions', () => {
    test('suggested actions render and are clickable', async ({ page }) => {
      await expect(page.getByRole('button', { name: /confirm/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /cancel/i }).first()).toBeVisible();
    });
  });

  test.describe('Error handling', () => {
    test('shows failed message with retry button', async ({ page }) => {
      await expect(page.getByText(/Failed to send/i).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /retry/i }).first()).toBeVisible();
    });
  });

  test.describe('Message styling', () => {
    test('applies message test id', async ({ page }) => {
      await expect(page.locator('[data-testid="message"]').first()).toBeVisible();
    });

    test('responsive layout on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(page.locator('[data-testid="message"]').first()).toBeVisible();
      const body = page.locator('body');
      const scrollWidth = await body.evaluate((el) => el.scrollWidth);
      const clientWidth = await body.evaluate((el) => el.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  });
});
