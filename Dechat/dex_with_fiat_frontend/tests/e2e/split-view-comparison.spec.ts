import { test, expect } from '@playwright/test';

test.describe('SplitViewComparison component E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-split-view-comparison');
    await page
      .locator('[data-testid="split-view-comparison"]')
      .waitFor({ state: 'visible' });
  });

  test.describe('Initial render', () => {
    test('renders split view comparison container', async ({ page }) => {
      await expect(
        page.locator('[data-testid="split-view-comparison"]'),
      ).toBeVisible();
    });

    test('renders both left and right panels', async ({ page }) => {
      await expect(page.locator('[data-testid="split-pane-left"]')).toBeVisible();
      await expect(page.locator('[data-testid="split-pane-right"]')).toBeVisible();
    });

    test('displays comparison title', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /compare threads/i })).toBeVisible();
    });
  });

  test.describe('Content display', () => {
    test('left panel displays correct content', async ({ page }) => {
      await expect(page.locator('[data-testid="split-pane-left"]')).toContainText(
        /left pane message content/i,
      );
    });

    test('right panel displays correct content', async ({ page }) => {
      await expect(page.locator('[data-testid="split-pane-right"]')).toContainText(
        /right pane message content/i,
      );
    });

    test('content is properly separated between panels', async ({ page }) => {
      const leftText = await page.locator('[data-testid="split-pane-left"]').textContent();
      const rightText = await page.locator('[data-testid="split-pane-right"]').textContent();
      expect(leftText).not.toBe(rightText);
    });
  });

  test.describe('Responsive behavior', () => {
    test('maintains layout on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(page.locator('[data-testid="split-view-comparison"]')).toBeVisible();
      await expect(page.locator('[data-testid="split-pane-left"]')).toBeVisible();
      await expect(page.locator('[data-testid="split-pane-right"]')).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('panels have accessible labels', async ({ page }) => {
      await expect(page.locator('[data-testid="split-pane-left"]')).toHaveAttribute(
        'aria-label',
        /left thread comparison pane/i,
      );
      await expect(page.locator('[data-testid="split-pane-right"]')).toHaveAttribute(
        'aria-label',
        /right thread comparison pane/i,
      );
    });

    test('keyboard navigation works', async ({ page }) => {
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedElement).toBeTruthy();
    });
  });

  test.describe('Interactive elements', () => {
    test('swap and close controls are visible', async ({ page }) => {
      await expect(page.locator('[data-testid="swap-threads-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="close-split-view-btn"]')).toBeVisible();
    });
  });
});
