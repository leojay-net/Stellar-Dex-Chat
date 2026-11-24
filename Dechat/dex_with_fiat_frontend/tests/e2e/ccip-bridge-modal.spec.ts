import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const modal = (page: Page) => page.getByRole('dialog', { name: 'CCIP Bridge' });
const pollingMessage = (page: Page) =>
  modal(page).getByText('Waiting for CCIP confirmation…', { exact: true });
const closeButton = (page: Page) =>
  modal(page).getByRole('button', { name: 'Close CCIP bridge dialog' });
const startButton = (page: Page) =>
  modal(page).getByRole('button', { name: 'Start CCIP transfer' });

async function chooseMode(page: Page, mode: 'pending' | 'error') {
  await closeButton(page).click();
  await page.getByRole('button', { name: `${mode} mode` }).click();
  await expect(page.getByText(mode, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Modal' }).click();
  await expect(closeButton(page)).toBeFocused();
}

async function pauseClock(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

test.describe('CCIPBridgeModal E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-ccip-bridge-modal');
    await expect(closeButton(page)).toBeFocused();
  });

  test.describe('Modal Opening and Closing', () => {
    test('should open modal on fixture page', async ({ page }) => {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        modal(page).getByRole('heading', { name: 'CCIP Bridge', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          /start a ccip transfer and monitor its confirmation state/i,
        ),
      ).toBeVisible();
    });

    test('should close modal when close button is clicked', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /close ccip bridge dialog/i })
        .click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });

    test('should close modal and reset state when reopened', async ({
      page,
    }) => {
      // Start a transfer
      await chooseMode(page, 'pending');
      await startButton(page).click();
      await expect(pollingMessage(page)).toBeVisible();

      // Close modal
      await page
        .getByRole('button', { name: /close ccip bridge dialog/i })
        .click();
      await expect(page.getByRole('dialog')).not.toBeVisible();

      // Reopen modal
      await page.getByRole('button', { name: /open modal/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      // Should be back to idle state
      await expect(
        page.getByRole('button', { name: /start ccip transfer/i }),
      ).toBeVisible();
    });
  });

  test.describe('Transfer Initiation', () => {
    test('should start CCIP transfer successfully', async ({ page }) => {
      await pauseClock(page);
      await startButton(page).click();

      // Should show optimistic UI first
      await expect(
        modal(page).getByText('Transfer Initiated!', { exact: true }),
      ).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        page.getByText(/processing your ccip transfer request/i),
      ).toBeVisible();

      await page.clock.runFor(500);

      // Should transition to polling state
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });
    });

    test('should display error when transfer fails to initiate', async ({
      page,
    }) => {
      // Switch to error mode
      await chooseMode(page, 'error');

      await startButton(page).click();

      // Should show error
      await expect(
        modal(page).getByText('CCIP transfer error', { exact: true }),
      ).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        modal(page).getByText('Failed to initiate CCIP transfer', {
          exact: true,
        }),
      ).toBeVisible();
    });
  });

  test.describe('Transfer Status Polling', () => {
    test('should poll and display PENDING status', async ({ page }) => {
      // Switch to pending mode
      await chooseMode(page, 'pending');

      await startButton(page).click();

      // Wait for polling state
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Should show pending status
      await expect(
        modal(page).getByText('Latest status: PENDING', { exact: true }),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should show spinner with proper accessibility
      const spinner = page.getByTestId('ccip-polling-spinner');
      await expect(spinner).toBeVisible();
      await expect(spinner).toHaveAttribute(
        'aria-label',
        /ccip transfer confirmation in progress/i,
      );
    });

    test('should transition from PENDING to SUCCESS', async ({ page }) => {
      // Default mode is success
      await pauseClock(page);
      await startButton(page).click();

      await page.clock.runFor(500);

      // Wait for polling
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      await page.clock.runFor(300);

      // Should eventually show success
      await expect(
        modal(page).getByText('CCIP transfer confirmed', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        modal(page).getByText('Status: SUCCESS', { exact: true }),
      ).toBeVisible();

      // Should show success icon
      const successIcon = page.getByTestId('ccip-success-icon');
      await expect(successIcon).toBeVisible();
    });

    test('should display transaction hash during polling', async ({ page }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      // Wait for polling state
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Should show transaction hash
      await expect(modal(page).getByText(/0xabc123def456/i)).toBeVisible();
    });

    test('should display explorer link during polling', async ({ page }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      // Wait for polling state
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Should show explorer link
      const explorerLink = page.getByRole('link', {
        name: /view transaction in ccip explorer/i,
      });
      await expect(explorerLink).toBeVisible();
      await expect(explorerLink).toHaveAttribute(
        'href',
        /ccip\.chain\.link\/status/,
      );
      await expect(explorerLink).toHaveAttribute('target', '_blank');
      await expect(explorerLink).toHaveAttribute('rel', 'noreferrer');
    });
  });

  test.describe('Transfer Success State', () => {
    test('should display success state with all details', async ({ page }) => {
      await startButton(page).click();

      // Wait for success
      await expect(
        modal(page).getByText('CCIP transfer confirmed', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });

      // Check all success elements
      await expect(page.getByTestId('ccip-success-icon')).toBeVisible();
      await expect(
        modal(page).getByText('Status: SUCCESS', { exact: true }),
      ).toBeVisible();
      await expect(modal(page).getByText(/0xabc123def456/i)).toBeVisible();

      // Explorer link should still be present
      const explorerLink = page.getByRole('link', {
        name: /view transaction in ccip explorer/i,
      });
      await expect(explorerLink).toBeVisible();
      await expect(explorerLink).toHaveAttribute('href', /0xabc123def456/);
    });
  });

  test.describe('Transfer Error Handling', () => {
    test('should display error state with message', async ({ page }) => {
      // Switch to error mode
      await chooseMode(page, 'error');

      await startButton(page).click();

      // Wait for error state
      await expect(
        modal(page).getByText('CCIP transfer error', { exact: true }),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should show error icon and message
      await expect(
        modal(page).locator('svg.lucide-circle-alert'),
      ).toBeVisible(); // AlertCircle icon
      await expect(
        modal(page).getByText('Failed to initiate CCIP transfer', {
          exact: true,
        }),
      ).toBeVisible();
    });
  });

  test.describe('Network Change Handling', () => {
    test('should clear state when network changes during polling', async ({
      page,
    }) => {
      // Start transfer on ethereum
      await chooseMode(page, 'pending');

      await startButton(page).click();

      // Wait for polling
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Change networks without discarding the transfer by reloading the fixture.
      await page.evaluate(() => {
        window.history.pushState(null, '', '?mode=pending&network=polygon');
        window.dispatchEvent(new Event('popstate'));
      });

      // Should show network changed warning
      await expect(page.getByText(/network changed/i)).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByText(/fee estimate cleared/i)).toBeVisible();

      // Should be back to idle state
      await expect(
        page.getByRole('button', { name: /start ccip transfer/i }),
      ).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA attributes', async ({ page }) => {
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAttribute(
        'aria-labelledby',
        'ccip-bridge-modal-title',
      );
      await expect(dialog).toHaveAttribute(
        'aria-describedby',
        'ccip-bridge-modal-description',
      );
    });

    test('should announce state changes to screen readers', async ({
      page,
    }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      // Check for live region
      const liveRegion = modal(page).getByRole('status');
      await expect(liveRegion).toBeAttached();

      // Live region should have content for polling state
      await expect(liveRegion).toContainText(/waiting for ccip confirmation/i, {
        timeout: 5_000,
      });
    });

    test('should have accessible button labels', async ({ page }) => {
      await expect(
        page.getByRole('button', { name: /start ccip transfer/i }),
      ).toHaveAttribute('aria-label', 'Start CCIP transfer');

      await expect(
        page.getByRole('button', { name: /close ccip bridge dialog/i }),
      ).toHaveAttribute('aria-label', 'Close CCIP bridge dialog');
    });

    test('should have properly hidden decorative elements', async ({
      page,
    }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      // Wait for polling with explorer link
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // External link icon should be aria-hidden
      const externalLinkIcon = modal(page)
        .getByRole('link', { name: 'View transaction in CCIP explorer' })
        .locator('svg.lucide-external-link');
      await expect(externalLinkIcon).toHaveAttribute('aria-hidden', 'true');
    });

    test('should provide alternative text for transaction hash', async ({
      page,
    }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Check for sr-only span with full context
      const srOnlySpan = page.locator('.sr-only', {
        hasText: /transaction hash/i,
      });
      await expect(srOnlySpan).toBeAttached();
    });
  });

  test.describe('Modal Focus Management', () => {
    test('should trap focus within modal', async ({ page }) => {
      const close = closeButton(page);
      const start = startButton(page);
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(start).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
    });

    test('should return focus after closing', async ({ page }) => {
      const openButton = page.getByRole('button', { name: /open modal/i });

      // Close modal
      await page
        .getByRole('button', { name: /close ccip bridge dialog/i })
        .click();
      await expect(page.getByRole('dialog')).not.toBeVisible();

      await openButton.focus();
      await openButton.press('Enter');
      await expect(closeButton(page)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(modal(page)).toBeHidden();
      await expect(openButton).toBeFocused();
    });
  });

  test.describe('Visual States', () => {
    test('should show loading spinner during optimistic state', async ({
      page,
    }) => {
      await pauseClock(page);
      await startButton(page).click();

      // Should show optimistic UI with checkmark
      await expect(
        modal(page).getByText('Transfer Initiated!', { exact: true }),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should show loading indicator
      await expect(
        modal(page).getByText('Preparing transaction', { exact: true }),
      ).toBeVisible();
      await expect(
        modal(page).locator('svg.lucide-loader-circle'),
      ).toBeVisible();
    });

    test('should display appropriate icons for each state', async ({
      page,
    }) => {
      // Success state
      await startButton(page).click();

      await expect(
        modal(page).getByText('CCIP transfer confirmed', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });

      // CheckCircle icon should be visible
      const successIcon = page.getByTestId('ccip-success-icon');
      await expect(successIcon).toBeVisible();
      await expect(successIcon).toHaveClass(/lucide-circle-check-big/);
    });
  });

  test.describe('Explorer Link Integration', () => {
    test('should generate correct explorer URL from transaction hash', async ({
      page,
    }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      const explorerLink = page.getByRole('link', {
        name: /view transaction in ccip explorer/i,
      });

      await expect(explorerLink).toHaveAttribute(
        'href',
        'https://ccip.chain.link/status?search=0xabc123def456',
      );
    });

    test('should open explorer link in new tab', async ({ page }) => {
      await chooseMode(page, 'pending');
      await startButton(page).click();

      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      const explorerLink = page.getByRole('link', {
        name: /view transaction in ccip explorer/i,
      });

      await expect(explorerLink).toHaveAttribute('target', '_blank');
      await expect(explorerLink).toHaveAttribute('rel', 'noreferrer');
    });
  });

  test.describe('Timeout Handling', () => {
    test('should handle timeout correctly', async ({ page }) => {
      // Go to timeout mode URL directly
      await page.goto('/test-ccip-bridge-modal?mode=timeout');

      // Wait for modal
      await expect(page.getByText('timeout', { exact: true })).toBeVisible();
      await expect(closeButton(page)).toBeFocused();

      await startButton(page).click();

      // Should show polling
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Should eventually timeout (short timeout in test mode)
      await expect(
        modal(page).getByText('CCIP transfer error', { exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        modal(page)
          .locator('p')
          .filter({ hasText: /timed out after 10 minutes/i }),
      ).toBeVisible();
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle rapid open/close cycles', async ({ page }) => {
      for (let i = 0; i < 3; i++) {
        await page
          .getByRole('button', { name: /close ccip bridge dialog/i })
          .click();
        await expect(page.getByRole('dialog')).not.toBeVisible();

        await page.getByRole('button', { name: /open modal/i }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
      }

      // Should still be functional
      await expect(
        page.getByRole('button', { name: /start ccip transfer/i }),
      ).toBeVisible();
    });

    test('should handle closing during transfer', async ({ page }) => {
      await chooseMode(page, 'pending');

      await startButton(page).click();

      // Wait for polling
      await expect(pollingMessage(page)).toBeVisible({
        timeout: 5_000,
      });

      // Close during polling
      await page
        .getByRole('button', { name: /close ccip bridge dialog/i })
        .click();
      await expect(page.getByRole('dialog')).not.toBeVisible();

      // Reopen - should be reset
      await page.getByRole('button', { name: /open modal/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /start ccip transfer/i }),
      ).toBeVisible();
    });
  });
});
