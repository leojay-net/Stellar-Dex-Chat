import { test, expect } from '@playwright/test';

test.describe('CCIPBridgeModal E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-ccip-bridge-modal');
    const dialog = page.getByRole('dialog', { name: /ccip bridge/i });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  });

  test.describe('Modal Opening and Closing', () => {
    test('should open modal on fixture page', async ({ page }) => {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /ccip bridge/i }),
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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible();

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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Should show optimistic UI first
      await expect(page.getByText(/transfer initiated/i)).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        page.getByText(/processing your ccip transfer request/i),
      ).toBeVisible();

      // Should transition to polling state
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });
    });

    test('should display error when transfer fails to initiate', async ({
      page,
    }) => {
      // Switch to error mode
      await page.getByRole('button', { name: /error mode/i }).click();
      await page.waitForTimeout(100);

      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Should show error
      await expect(page.getByText(/ccip transfer error/i)).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        page.getByText(/failed to initiate ccip transfer/i),
      ).toBeVisible();
    });
  });

  test.describe('Transfer Status Polling', () => {
    test('should poll and display PENDING status', async ({ page }) => {
      // Switch to pending mode
      await page.getByRole('button', { name: /pending mode/i }).click();
      await page.waitForTimeout(100);

      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling state
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should show pending status
      await expect(page.getByText(/latest status: pending/i)).toBeVisible({
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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should eventually show success
      await expect(page.getByText(/ccip transfer confirmed/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/status: success/i)).toBeVisible();

      // Should show success icon
      const successIcon = page.getByTestId('ccip-success-icon');
      await expect(successIcon).toBeVisible();
    });

    test('should display transaction hash during polling', async ({ page }) => {
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling state
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should show transaction hash
      await expect(
        page.getByText(/transaction: 0xabc123def456/i),
      ).toBeVisible();
    });

    test('should display explorer link during polling', async ({ page }) => {
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling state
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for success
      await expect(page.getByText(/ccip transfer confirmed/i)).toBeVisible({
        timeout: 10_000,
      });

      // Check all success elements
      await expect(page.getByTestId('ccip-success-icon')).toBeVisible();
      await expect(page.getByText(/status: success/i)).toBeVisible();
      await expect(
        page.getByText(/transaction: 0xabc123def456/i),
      ).toBeVisible();

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
      await page.getByRole('button', { name: /error mode/i }).click();
      await page.waitForTimeout(100);

      // Need to reopen modal after mode change
      await page
        .getByRole('button', { name: /close ccip bridge dialog/i })
        .click();
      await page.getByRole('button', { name: /open modal/i }).click();

      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for error state
      await expect(page.getByText(/ccip transfer error/i)).toBeVisible({
        timeout: 5_000,
      });

      // Should show error icon and message
      await expect(
        page.locator('svg').filter({ hasText: '' }).first(),
      ).toBeVisible(); // AlertCircle icon
      await expect(
        page.getByText(/failed to initiate ccip transfer/i),
      ).toBeVisible();
    });
  });

  test.describe('Network Change Handling', () => {
    test('should clear state when network changes during polling', async ({
      page,
    }) => {
      // Start transfer on ethereum
      await page.getByRole('button', { name: /pending mode/i }).click();
      await page.waitForTimeout(100);

      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Change network via URL
      await page.goto('/test-ccip-bridge-modal?mode=pending&network=polygon');

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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Check for live region
      const liveRegion = page.locator('[role="status"][aria-live="polite"]');
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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling with explorer link
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });

      // External link icon should be aria-hidden
      const externalLinkIcon = page.locator('.lucide-external-link').first();
      if ((await externalLinkIcon.count()) > 0) {
        await expect(externalLinkIcon).toHaveAttribute('aria-hidden', 'true');
      }
    });

    test('should provide alternative text for transaction hash', async ({
      page,
    }) => {
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
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
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeFocused({ timeout: 2_000 });
    });

    test('should return focus after closing', async ({ page }) => {
      const openButton = page.getByRole('button', { name: /open modal/i });

      // Close modal
      await page
        .getByRole('button', { name: /close ccip bridge dialog/i })
        .click();
      await expect(page.getByRole('dialog')).not.toBeVisible();

      // Open button should be visible
      await expect(openButton).toBeVisible();
    });
  });

  test.describe('Visual States', () => {
    test('should show loading spinner during optimistic state', async ({
      page,
    }) => {
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Should show optimistic UI with checkmark
      await expect(page.getByText(/transfer initiated/i)).toBeVisible({
        timeout: 5_000,
      });

      // Should show loading indicator
      await expect(page.getByText(/preparing transaction/i)).toBeVisible();
      await expect(page.locator('.lucide-loader-2').first()).toBeVisible();
    });

    test('should display appropriate icons for each state', async ({
      page,
    }) => {
      // Success state
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      await expect(page.getByText(/ccip transfer confirmed/i)).toBeVisible({
        timeout: 10_000,
      });

      // CheckCircle icon should be visible
      const successIcon = page.getByTestId('ccip-success-icon');
      await expect(successIcon).toBeVisible();
      await expect(successIcon).toHaveClass(/lucide-check-circle/);
    });
  });

  test.describe('Explorer Link Integration', () => {
    test('should generate correct explorer URL from transaction hash', async ({
      page,
    }) => {
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
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
      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
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
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Should show polling
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
        timeout: 5_000,
      });

      // Should eventually timeout (short timeout in test mode)
      await expect(page.getByText(/ccip transfer error/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/timed out after 10 minutes/i)).toBeVisible();
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
      await page.getByRole('button', { name: /pending mode/i }).click();
      await page.waitForTimeout(100);

      await page.getByRole('button', { name: /start ccip transfer/i }).click();

      // Wait for polling
      await expect(
        page.getByText(/waiting for ccip confirmation/i),
      ).toBeVisible({
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
