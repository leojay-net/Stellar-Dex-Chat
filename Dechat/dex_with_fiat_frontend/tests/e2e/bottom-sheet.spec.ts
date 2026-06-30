import { test, expect } from '@playwright/test';

test.describe('Mobile Bottom-Sheet for Wallet Actions', () => {
  test.describe('Mobile viewport (< 640px)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test.beforeEach(async ({ page }) => {
      await page.goto('/test-bottom-sheet');
    });

    test('should render bottom-sheet with drag handle on mobile', async ({
      page,
    }) => {
      await page.getByRole('button', { name: /open bottom sheet/i }).click();
      await expect(page.locator('[data-testid="bottom-sheet"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="bottom-sheet-drag-handle"]'),
      ).toBeVisible();
    });

    test('should close bottom-sheet via close button', async ({ page }) => {
      await page.getByRole('button', { name: /open bottom sheet/i }).click();
      const sheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(sheet).toBeVisible();
      await page.locator('[data-testid="bottom-sheet-close-btn"]').click();
      await expect(sheet).not.toBeVisible();
    });

    test('should close bottom-sheet on overlay click', async ({ page }) => {
      await page.getByRole('button', { name: /open bottom sheet/i }).click();
      const overlay = page.locator('[data-testid="bottom-sheet-overlay"]');
      await expect(overlay).toBeVisible();
      await overlay.click({ position: { x: 187, y: 50 } });
      await expect(page.locator('[data-testid="bottom-sheet"]')).not.toBeVisible();
    });

    test('should close bottom-sheet on Escape key', async ({ page }) => {
      await page.getByRole('button', { name: /open bottom sheet/i }).click();
      const sheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).not.toBeVisible();
    });
  });

  test.describe('Desktop viewport (>= 640px)', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('should render centered modal on desktop fixture page', async ({
      page,
    }) => {
      await page.goto('/test-stellar-fiat-modal');
      const dialog = page.getByRole('dialog', { name: /deposit to bridge/i });
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-testid="bottom-sheet"]')).not.toBeVisible();
    });
  });
});
