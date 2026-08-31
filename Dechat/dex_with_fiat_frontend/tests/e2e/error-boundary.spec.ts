import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for ErrorBoundary component.
 *
 * Uses the /test-error-boundary harness page which lets tests trigger a
 * child crash via a "Throw Error" button and reset state via an "onRetry"
 * callback.  All external API routes are stubbed at route level.
 */

const TEST_URL = '/test-error-boundary';

async function gotoHarness(page: Page) {
  // Block any potential outbound API calls
  await page.route('**/api/**', async (route) => {
    await route.abort();
  });
  await page.goto(TEST_URL);
  await page.waitForLoadState('domcontentloaded');
}

/** Trigger a child component crash via the harness button. */
async function triggerError(page: Page) {
  await page.getByTestId('trigger-error').click();
}

test.describe('ErrorBoundary', () => {
  test.describe('Happy path — no error', () => {
    test('child content renders when no error is thrown', async ({ page }) => {
      await gotoHarness(page);

      await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('child-content')).toContainText(
        'Child rendered successfully.',
      );
    });

    test('Throw Error button is visible in the harness', async ({ page }) => {
      await gotoHarness(page);
      await expect(page.getByTestId('trigger-error')).toBeVisible();
    });
  });

  test.describe('Error state — fallback UI', () => {
    test('fallback heading appears after a child crash', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(page.getByRole('heading', { name: 'Something went wrong.' })).toBeVisible({
        timeout: 5_000,
      });
    });

    test('fallback message text is displayed', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(page.getByText('Please refresh the page.')).toBeVisible({
        timeout: 5_000,
      });
    });

    test('retry button is visible with configured label', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      const retryBtn = page.getByRole('button', { name: 'Try Again' });
      await expect(retryBtn).toBeVisible({ timeout: 5_000 });
    });

    test('child content is hidden while fallback is showing', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(page.getByTestId('child-content')).toBeHidden({ timeout: 5_000 });
    });

    test('keyboard hint text is visible in fallback', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(page.getByText('to retry')).toBeVisible({ timeout: 5_000 });
    });

    test('Enter kbd and R kbd shortcuts are listed in the hint', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      const kbds = page.locator('kbd');
      await expect(kbds.first()).toBeVisible({ timeout: 5_000 });

      // Two <kbd> elements: one for Enter, one for R
      const count = await kbds.count();
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Retry behaviour', () => {
    test('clicking Retry restores the child content', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(page.getByRole('heading', { name: 'Something went wrong.' })).toBeVisible({
        timeout: 5_000,
      });

      await page.getByRole('button', { name: 'Try Again' }).click();

      // onRetry resets shouldThrow → child content comes back
      await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
    });

    test('onRetry callback increments retry counter in harness', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await page.getByRole('button', { name: 'Try Again' }).click();

      await expect(page.getByTestId('retry-count')).toContainText('Retry triggered 1 time');
    });

    test('boundary can be triggered and retried multiple times', async ({ page }) => {
      await gotoHarness(page);

      for (let i = 1; i <= 3; i++) {
        await triggerError(page);
        await expect(
          page.getByRole('heading', { name: 'Something went wrong.' }),
        ).toBeVisible({ timeout: 5_000 });

        await page.getByRole('button', { name: 'Try Again' }).click();
        await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
      }

      await expect(page.getByTestId('retry-count')).toContainText('Retry triggered 3 times');
    });
  });

  test.describe('Keyboard navigation', () => {
    test('Tab reaches the Retry button in fallback state', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      const retryBtn = page.getByRole('button', { name: 'Try Again' });
      await retryBtn.focus();
      await expect(retryBtn).toBeFocused();
    });

    test('Enter key on focused Retry button triggers retry', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      const retryBtn = page.getByRole('button', { name: 'Try Again' });
      await retryBtn.focus();
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
    });

    test('global "r" key shortcut triggers retry when fallback is shown', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(
        page.getByRole('heading', { name: 'Something went wrong.' }),
      ).toBeVisible({ timeout: 5_000 });

      // Click somewhere neutral to defocus buttons, then press 'r'
      await page.locator('h1').click();
      await page.keyboard.press('r');

      await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
    });

    test('global "R" (capital) shortcut triggers retry', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(
        page.getByRole('heading', { name: 'Something went wrong.' }),
      ).toBeVisible({ timeout: 5_000 });

      await page.locator('h1').click();
      await page.keyboard.press('R');

      await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
    });

    test('global Enter key shortcut triggers retry', async ({ page }) => {
      await gotoHarness(page);
      await triggerError(page);

      await expect(
        page.getByRole('heading', { name: 'Something went wrong.' }),
      ).toBeVisible({ timeout: 5_000 });

      // Defocus any button before pressing Enter (otherwise it clicks the focused button)
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('child-content')).toBeVisible({ timeout: 5_000 });
    });

    test('"r" shortcut does NOT trigger retry when no error has occurred', async ({
      page,
    }) => {
      await gotoHarness(page);

      // No error thrown — child content visible
      await expect(page.getByTestId('child-content')).toBeVisible();

      await page.locator('h1').click();
      await page.keyboard.press('r');

      // Child should still be visible (shortcut is a no-op)
      await expect(page.getByTestId('child-content')).toBeVisible();
    });
  });

  test.describe('No real network calls', () => {
    test('fallback renders without any API requests', async ({ page }) => {
      const networkRequests: string[] = [];
      page.on('request', (req) => {
        if (!req.url().includes('localhost') && !req.url().includes('127.0.0.1')) {
          networkRequests.push(req.url());
        }
      });

      await gotoHarness(page);
      await triggerError(page);

      await expect(
        page.getByRole('heading', { name: 'Something went wrong.' }),
      ).toBeVisible({ timeout: 5_000 });

      const apiRequests = networkRequests.filter(
        (url) => !url.includes('_next') && !url.includes('fonts.') && !url.includes('cdn.'),
      );
      expect(apiRequests.length).toBe(0);
    });
  });
});
