import { expect } from '@playwright/test';
import { test } from './fixtures';
import { gotoChatConnected } from './helpers';

test.describe('ReceiptDrawer', () => {
  test.beforeEach(async ({ page }) => {
    await gotoChatConnected(page);
  });

  test('opens from header and closes via accessible close control', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Receipts' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Transaction Receipts' }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Close transaction receipts' })
      .click();

    await expect(page.locator('.receipt-drawer-panel')).toHaveClass(
      /translate-x-full/,
    );
  });
});
