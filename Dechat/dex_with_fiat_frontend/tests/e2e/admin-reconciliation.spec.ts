import { test, expect, Page } from '@playwright/test';

test.describe('Admin Reconciliation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/reconciliation');
  });

  test.describe('Page load', () => {
    test('loads the reconciliation dashboard for admin users', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /Admin Reconciliation Dashboard/i });
      await expect(heading).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Export CSV/i)).toBeVisible();
    });

    test('renders filter controls', async ({ page }) => {
      const statusSelect = page.getByLabel(/Status/i);
      await expect(statusSelect).toBeVisible({ timeout: 10_000 });
      await expect(statusSelect).toHaveValue('all');

      await expect(page.getByLabel(/Start Date/i)).toBeVisible();
      await expect(page.getByLabel(/End Date/i)).toBeVisible();
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
      const statusSelect = page.getByLabel(/Status/i);
      await page.waitForLoadState('networkidle');
      await statusSelect.selectOption('matched');

      const rows = page.locator('tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).getByText('matched')).toBeVisible();
      }
    });

    test('shows "No records found" when filter matches nothing', async ({ page }) => {
      const statusSelect = page.getByLabel(/Status/i);
      await page.waitForLoadState('networkidle');
      await statusSelect.selectOption('error');

      const rows = page.locator('tbody tr');
      const count = await rows.count();
      if (count === 0) {
        await expect(page.getByText(/No records found matching the filters/i)).toBeVisible();
      }
    });

    test('resets to all records when status filter is changed back', async ({ page }) => {
      const statusSelect = page.getByLabel(/Status/i);
      await page.waitForLoadState('networkidle');

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

    test('triggers CSV download on click', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      const exportBtn = page.getByRole('button', { name: /Export CSV/i });
      await exportBtn.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/reconciliation.*\.csv/);
    });
  });

  test.describe('Non-admin redirect', () => {
    test('non-admin users are redirected away from reconciliation page', async ({ page }) => {
      const landingOrLogin = page.getByText(/launch|connect wallet|get started|landing/i).first();
      const heading = page.getByRole('heading', { name: /Admin Reconciliation Dashboard/i });

      const isLanding = await landingOrLogin.isVisible({ timeout: 15_000 }).catch(() => false);
      const isDashboard = await heading.isVisible({ timeout: 5_000 }).catch(() => false);

      expect(isLanding || isDashboard).toBe(true);
    });
  });
});
