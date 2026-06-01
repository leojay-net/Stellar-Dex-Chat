import { test, expect } from '@playwright/test';

test.describe('Message component E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-message');
  });

  test('renders markdown link and opens in new tab', async ({ page }) => {
    const anchor = page.locator('a', { hasText: 'link' }).first();
    await expect(anchor).toBeVisible();
    await expect(anchor).toHaveAttribute('href', 'https://example.com');
    await expect(anchor).toHaveAttribute('target', '_blank');
  });

  test('shows transaction details and copy buttons', async ({ page }) => {
    await expect(page.getByText(/Transaction Details/i)).toBeVisible();
    await expect(page.getByText(/Receipt ID:/i)).toBeVisible();
    // copy buttons are present (two for txHash and receiptId)
    const copyButtons = page.locator('button').filter({ hasText: '' });
    await expect(copyButtons.first()).toBeVisible();
  });

  test('suggested actions render and are clickable', async ({ page }) => {
    const confirmBtn = page.getByRole('button', { name: /confirm/i }).first();
    const cancelBtn = page.getByRole('button', { name: /cancel/i }).first();
    await expect(confirmBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    await confirmBtn.click();
    await cancelBtn.click();
  });

  test('shows failed message with retry button', async ({ page }) => {
    await expect(page.getByText(/Failed to send/i)).toBeVisible();
    const retry = page.getByRole('button', { name: /retry/i }).first();
    await expect(retry).toBeVisible();
  });
});
