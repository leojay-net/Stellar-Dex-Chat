import { test, expect } from '@playwright/test';

test.describe('Mobile Bottom-Sheet for Wallet Actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chat');

    // Mock connected wallet
    await page.addInitScript(() => {
      window.freighter = {
        isConnected: async () => ({ isConnected: true }),
        getAddress: async () => ({
          address:
            'GD5DJQD7KGYRY4TSK4K2V5J2D2J2XQK2T2D2J2XQK2T2D2J2XQK2T2D2J2XQK2T2D2J2XQK2',
        }),
        getNetwork: async () => ({ network: 'TESTNET' }),
        signTransaction: async () => ({
          signedTxXdr: 'AAAAAgAAAABzZXJ2aWNlX3BvaW50X2hvc3QAAAAAAAAAAAAA',
          error: null,
        }),
        requestAccess: async () => ({
          address:
            'GD5DJQD7KGYRY4TSK4K2V5J2D2J2XQK2T2D2J2XQK2T2D2J2XQK2T2D2J2XQK2T2D2J2XQK2',
        }),
      };
    });

    await page.waitForTimeout(1000);
  });

  test.describe('Mobile viewport (< 640px)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('should render bottom-sheet with drag handle on mobile', async ({
      page,
    }) => {
      const depositButton = page.locator('button', {
        hasText: /deposit/i,
      });
      await depositButton.click();

      const sheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(sheet).toBeVisible();

      const dragHandle = page.locator(
        '[data-testid="bottom-sheet-drag-handle"]',
      );
      await expect(dragHandle).toBeVisible();
    });

    test('should close bottom-sheet via close button', async ({ page }) => {
      const depositButton = page.locator('button', {
        hasText: /deposit/i,
      });
      await depositButton.click();

      const sheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(sheet).toBeVisible();

      const closeBtn = page.locator(
        '[data-testid="bottom-sheet-close-btn"]',
      );
      await closeBtn.click();

      await expect(sheet).not.toBeVisible();
    });

    test('should close bottom-sheet on overlay click', async ({ page }) => {
      const depositButton = page.locator('button', {
        hasText: /deposit/i,
      });
      await depositButton.click();

      const overlay = page.locator('[data-testid="bottom-sheet-overlay"]');
      await expect(overlay).toBeVisible();

      // Click on overlay backdrop area (top of screen, outside sheet)
      await overlay.click({ position: { x: 187, y: 50 } });

      const sheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(sheet).not.toBeVisible();
    });

    test('should close bottom-sheet on Escape key', async ({ page }) => {
      const depositButton = page.locator('button', {
        hasText: /deposit/i,
      });
      await depositButton.click();

      const sheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(sheet).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(sheet).not.toBeVisible();
    });
  });

  test.describe('Desktop viewport (>= 640px)', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('should render centered modal on desktop', async ({ page }) => {
      const depositButton = page.locator('button', {
        hasText: /deposit/i,
      });
      await depositButton.click();

      // Desktop should render the standard dialog, not the bottom-sheet
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();

      const bottomSheet = page.locator('[data-testid="bottom-sheet"]');
      await expect(bottomSheet).not.toBeVisible();
    });
  });
});
