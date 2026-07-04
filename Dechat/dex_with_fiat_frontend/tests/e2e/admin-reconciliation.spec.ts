import { test, expect } from '@playwright/test';
import {
  gotoAdminReconciliation,
  mockSorobanRpc,
  mockReconciliationApi,
  MOCK_ADMIN_ADDRESS,
  connectMockWallet,
  installMockWalletBridge,
  adminReconciliationHeading,
} from './helpers';

/** Non-admin wallet address (valid 56-char Stellar key). */
const NON_ADMIN_ADDRESS =
  'G9876543210987654321098765432109876543210987654321098765';

test.describe('Admin Reconciliation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminReconciliation(page);
  });

  test.describe('Page load', () => {
    test('loads the reconciliation dashboard for admin users', async ({ page }) => {
      await expect(adminReconciliationHeading(page)).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/Export CSV/i)).toBeVisible();
    });

    test('renders filter controls', async ({ page }) => {
      const statusSelect = page.getByRole('combobox').first();
      await expect(statusSelect).toBeVisible({ timeout: 10_000 });
      await expect(statusSelect).toHaveValue('all');

      const dateInputs = page.locator('input[type="date"]');
      await expect(dateInputs).toHaveCount(2);
    });

    test('renders reconciliation table with records', async ({ page }) => {
      await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
      const rows = page.getByRole('row');
      const count = await rows.count();
      expect(count).toBeGreaterThan(1);
    });
  });

  test.describe('Filtering', () => {
    test('filters records by status', async ({ page }) => {
      const statusSelect = page.getByRole('combobox').first();
      await statusSelect.selectOption('matched');

      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).getByText('matched')).toBeVisible();
      }
    });

    test('shows "No records found" when filter matches nothing', async ({
      page,
    }) => {
      const statusSelect = page.getByRole('combobox').first();
      await statusSelect.selectOption('error');

      // Narrow date range so no records match
      const dateInputs = page.locator('input[type="date"]');
      await dateInputs.nth(0).fill('2099-01-01');
      await dateInputs.nth(1).fill('2099-12-31');

      await expect(
        page.getByText(/No records found matching the filters/i),
      ).toBeVisible();
    });

    test('resets to all records when status filter is changed back', async ({
      page,
    }) => {
      const statusSelect = page.getByRole('combobox').first();

      await statusSelect.selectOption('matched');
      await statusSelect.selectOption('all');

      const rows = page.locator('tbody tr');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('CSV Export', () => {
    test('Export CSV button is visible and enabled', async ({ page }) => {
      const exportBtn = page.getByRole('button', { name: /Export CSV/i });
      await expect(exportBtn).toBeVisible();
      await expect(exportBtn).toBeEnabled();
    });

    test('triggers CSV download on click', async ({ page }) => {
      const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
      const exportBtn = page.getByRole('button', { name: /Export CSV/i });
      await exportBtn.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/reconciliation.*\.csv/);
    });
  });
});

test.describe('Admin Reconciliation E2E — access control', () => {
  test('non-admin users are redirected away from reconciliation page', async ({
    page,
  }) => {
    await mockSorobanRpc(page, { adminAddress: MOCK_ADMIN_ADDRESS });
    await mockReconciliationApi(page);
    await installMockWalletBridge(page);
    await page.goto('/admin/reconciliation');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => window.clearBridgeCache?.());
    await connectMockWallet(page, NON_ADMIN_ADDRESS);
    await expect(page.getByText(/Verifying admin access/i)).toBeHidden({
      timeout: 30_000,
    });

    await expect(adminReconciliationHeading(page)).toBeHidden({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('button', { name: /start bridging/i }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
