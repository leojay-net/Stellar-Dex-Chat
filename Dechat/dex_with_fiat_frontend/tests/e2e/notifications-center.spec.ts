import { test, expect } from '@playwright/test';

test.describe('NotificationsCenter E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-notifications-center');
    await page.waitForLoadState('domcontentloaded');
  });

  test.describe('Empty state', () => {
    test('shows empty state when no notifications', async ({ page }) => {
      await page.click('button:has-text("Empty State")');
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await expect(bellButton).toBeVisible();
      await bellButton.click();
      await expect(page.getByText('No notifications yet')).toBeVisible();
    });

    test('shows zero unread count badge when empty', async ({ page }) => {
      await page.click('button:has-text("Empty State")');
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await expect(bellButton).toBeVisible();
      const badge = bellButton.locator('span:has-text("0")');
      await expect(badge).not.toBeVisible();
    });
  });

  test.describe('With unread notifications', () => {
    test.beforeEach(async ({ page }) => {
      await page.click('button:has-text("With Unread Notifications")');
    });

    test('shows unread count badge', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await expect(bellButton.locator('span')).toContainText('3');
    });

    test('opens dropdown and shows notifications list', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      const dropdown = page.locator('div[class*="absolute right-0"]').first();
      await expect(dropdown.getByText('Transaction submitted to network')).toBeVisible();
      await expect(dropdown.getByText('Payout of 100 USDC is pending')).toBeVisible();
      await expect(dropdown.getByText('High slippage detected on XLM/USDC')).toBeVisible();
    });

    test('shows mark all as read and clear all buttons', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await expect(page.getByRole('button', { name: /mark all as read/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /clear all/i })).toBeVisible();
    });

    test('mark all as read marks all notifications as read', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.getByRole('button', { name: /mark all as read/i }).click();
      await expect(bellButton.locator('span')).not.toBeVisible();
    });

    test('clear all removes all notifications', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.getByRole('button', { name: /clear all/i }).click();
      await expect(page.getByText('No notifications yet')).toBeVisible();
      await expect(bellButton.locator('span')).not.toBeVisible();
    });

    test('clicking individual notification marks it as read', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      const firstNotification = page.locator('div.cursor-pointer').filter({ hasText: 'Transaction submitted to network' }).first();
      await firstNotification.click();
      await expect(bellButton.locator('span')).toContainText('2');
    });
  });

  test.describe('All read notifications', () => {
    test.beforeEach(async ({ page }) => {
      await page.click('button:has-text("All Read Notifications")');
    });

    test('shows read notifications without unread badge', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await expect(bellButton.locator('span')).not.toBeVisible();
      await bellButton.click();
      await expect(page.getByText('Transaction confirmed on ledger')).toBeVisible();
      await expect(page.getByText('Payout completed successfully')).toBeVisible();
    });

    test('shows clear all button when all read', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await expect(page.getByRole('button', { name: /clear all/i })).toBeVisible();
    });
  });

  test.describe('Mixed read/unread notifications', () => {
    test.beforeEach(async ({ page }) => {
      await page.click('button:has-text("Mixed Read/Unread")');
    });

    test('shows correct unread count', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await expect(bellButton.locator('span')).toContainText('2');
    });

    test('shows both read and unread notifications', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      const dropdown = page.locator('div[class*="absolute right-0"]').first();
      await expect(dropdown.getByText('Transaction submitted to network')).toBeVisible();
      await expect(dropdown.getByText('Transaction confirmed on ledger')).toBeVisible();
      await expect(dropdown.getByText('Payout completed successfully')).toBeVisible();
    });
  });

  test.describe('Keyboard navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.click('button:has-text("With Unread Notifications")');
    });

    test('opens dropdown with Enter key', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    });

    test('opens dropdown with Space key', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    });

    test('closes dropdown with Escape key', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).not.toBeVisible();
    });

    test('navigates to mark all as read with Tab key', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: /mark all as read/i })).toBeFocused();
    });

    test('navigates to clear all with Tab key', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: /clear all/i })).toBeFocused();
    });

    test('navigates to close button with Tab key', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const closeButton = page.locator('button[aria-label="Notifications"]').locator('..').locator('button').last();
      await expect(closeButton).toBeFocused();
    });

    test('mark all as read with M key shortcut', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.keyboard.press('m');
      await expect(bellButton.locator('span')).not.toBeVisible();
    });

    test('clear all with D key shortcut', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.keyboard.press('d');
      await expect(page.getByText('No notifications yet')).toBeVisible();
    });

    test('can navigate through notification items with Tab', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const firstNotification = page.locator('div.cursor-pointer').filter({ hasText: 'Transaction submitted to network' }).first();
      await expect(firstNotification).toBeVisible();
    });
  });

  test.describe('Click outside to close', () => {
    test.beforeEach(async ({ page }) => {
      await page.click('button:has-text("With Unread Notifications")');
    });

    test('closes dropdown when clicking outside', async ({ page }) => {
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await page.locator('body').click({ position: { x: 0, y: 0 } });
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).not.toBeVisible();
    });
  });

  test.describe('Persistence across scenarios', () => {
    test('notifications persist when switching scenarios', async ({ page }) => {
      await page.click('button:has-text("With Unread Notifications")');
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await expect(bellButton.locator('span')).toContainText('3');

      await page.click('button:has-text("Empty State")');
      await expect(bellButton.locator('span')).not.toBeVisible();

      await page.click('button:has-text("With Unread Notifications")');
      await expect(bellButton.locator('span')).toContainText('3');
    });
  });

  test.describe('Visual states', () => {
    test('unread notifications have distinct styling from read ones', async ({ page }) => {
      await page.click('button:has-text("Mixed Read/Unread")');
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();

      const unreadNotification = page.locator('div.cursor-pointer').filter({ hasText: 'Transaction submitted to network' }).first();
      const readNotification = page.locator('div.cursor-pointer').filter({ hasText: 'Payout completed successfully' }).first();

      const unreadBg = await unreadNotification.evaluate((el) => window.getComputedStyle(el).backgroundColor);
      const readBg = await readNotification.evaluate((el) => window.getComputedStyle(el).backgroundColor);

      expect(unreadBg).not.toBe(readBg);
    });

    test('notification type indicator dots are visible for unread notifications', async ({ page }) => {
      await page.click('button:has-text("With Unread Notifications")');
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();

      const dots = page.locator('div.w-2.h-2.rounded-full');
      await expect(dots.first()).toBeVisible();
    });
  });

  test.describe('Timestamp formatting', () => {
    test('shows relative time for recent notifications', async ({ page }) => {
      await page.click('button:has-text("With Unread Notifications")');
      const bellButton = page.locator('button[aria-label="Notifications"]');
      await bellButton.click();

      const timestamp = page.locator('text=Just now').first();
      await expect(timestamp).toBeVisible();
    });
  });
});