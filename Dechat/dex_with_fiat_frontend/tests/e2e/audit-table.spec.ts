import { test, expect, type Page } from '@playwright/test';
import { mockSorobanRpc, installMockWalletBridge, connectMockWallet, MOCK_ADMIN_ADDRESS } from './helpers';

/*
 * These tests exercise the "Admin Audit Log" section of /admin, which is backed
 * by /api/admin/audit-log (mocked below). The page also renders a second,
 * separate <AuditTable /> ("Audit Log", backed by /api/admin-audit), so every
 * locator is scoped to the admin audit log's own controls / table to avoid
 * matching both.
 */

/** Rows of the admin audit log table. */
function auditLogTable(page: Page) {
  return page.getByRole('table', { name: 'Admin audit log entries' });
}

/** The admin audit log "Action Type" filter (labelled via htmlFor). */
function actionFilter(page: Page) {
  return page.getByRole('combobox', { name: 'Action Type' });
}

async function gotoAdmin(page: Page) {
  await installMockWalletBridge(page);
  await page.goto('/admin');
  await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
}

/** Wait until the admin audit log has finished its initial fetch. */
async function waitForAuditLogLoaded(page: Page) {
  await expect(page.getByText('Loading audit entries...')).toBeHidden();
}

test.describe('AuditTable E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Soroban RPC for admin authentication
    await mockSorobanRpc(page, { adminAddress: MOCK_ADMIN_ADDRESS });
    
    // Mock the admin audit-log API route
    await page.route('**/api/admin/audit-log*', async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      
      // Default happy path response
      const entries = [
        {
          id: '1',
          timestamp: new Date('2026-03-20T10:00:00Z').toISOString(),
          adminAddress: 'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
          action: 'withdrawal_approved' as const,
          parameters: { userId: 'user123', amount: 100 },
          result: 'success',
        },
        {
          id: '2',
          timestamp: new Date('2026-03-21T14:30:00Z').toISOString(),
          adminAddress: 'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
          action: 'withdrawal_rejected' as const,
          parameters: { userId: 'user456', reason: 'Insufficient funds' },
          result: 'failed',
        },
        {
          id: '3',
          timestamp: new Date('2026-03-22T09:15:00Z').toISOString(),
          adminAddress: 'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
          action: 'reconciliation_adjustment' as const,
          parameters: { adjustmentAmount: 50 },
          result: 'success',
        },
      ];

      // Filter entries if action is specified
      const filteredEntries = action && action !== 'all' 
        ? entries.filter(entry => entry.action === action)
        : entries;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: filteredEntries,
          page: 1,
          pageSize: 20,
          total: filteredEntries.length,
          totalPages: 1,
          actions: ['withdrawal_approved', 'withdrawal_rejected', 'reconciliation_adjustment', 'operator_added', 'operator_removed', 'bridge_paused', 'bridge_unpaused'],
        }),
      });
    });

    // Mock reconciliation API for the admin dashboard
    await page.route('**/api/admin/reconciliation*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
  });

  test('should display loading state', async ({ page }) => {
    // Hold the audit-log response until the loading state has been asserted.
    // The fetch starts on mount, before the admin guard finishes connecting
    // the wallet, so a short fixed delay is not enough to observe it.
    let releaseResponse: () => void = () => {};
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route('**/api/admin/audit-log*', async (route) => {
      await responseGate;
      await route.fallback();
    });

    await gotoAdmin(page);

    // Check for the loading indicator
    await expect(page.getByText('Loading audit entries...')).toBeVisible();
    await expect(actionFilter(page)).toBeDisabled();

    releaseResponse();
    await waitForAuditLogLoaded(page);
    await expect(auditLogTable(page).getByRole('cell', { name: 'Withdrawal Approved' })).toBeVisible();
  });

  test('should display empty state', async ({ page }) => {
    await page.route('**/api/admin/audit-log*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
          actions: [],
        }),
      });
    });

    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // The audit section should show empty state
    await expect(
      page.getByText('No audit entries found for the selected action type.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export audit log to CSV file' })).toBeDisabled();
  });

  test('should display error state', async ({ page }) => {
    await page.route('**/api/admin/audit-log*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await gotoAdmin(page);

    // Check for error message in audit section
    await expect(page.getByText('Failed to fetch admin audit logs (500)')).toBeVisible();
  });

  test('should display audit entries in happy path', async ({ page }) => {
    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // Check that audit entries are displayed
    const table = auditLogTable(page);
    await expect(table.getByRole('cell', { name: 'Withdrawal Approved' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Withdrawal Rejected' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Reconciliation Adjustment' })).toBeVisible();
  });

  test('should filter by action type', async ({ page }) => {
    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // Select withdrawal_approved filter
    await actionFilter(page).selectOption('withdrawal_approved');

    // Wait for filtered results
    const table = auditLogTable(page);
    await expect(table.getByRole('cell', { name: 'Withdrawal Approved' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Withdrawal Rejected' })).toBeHidden();
  });

  test('should reset filters', async ({ page }) => {
    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // Apply filter
    const filter = actionFilter(page);
    await filter.selectOption('withdrawal_approved');
    const table = auditLogTable(page);
    await expect(table.getByRole('cell', { name: 'Withdrawal Rejected' })).toBeHidden();

    // Reset filter by selecting 'all'
    await filter.selectOption('all');

    // Verify filter is reset - all entries should be visible
    await expect(table.getByRole('cell', { name: 'Withdrawal Approved' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Withdrawal Rejected' })).toBeVisible();
  });

  test('should export CSV', async ({ page }) => {
    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // Click export button
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export audit log to CSV file' }).click();
    const download = await downloadPromise;

    // Verify download
    expect(download.suggestedFilename()).toMatch(/admin_audit_log_.*\.csv/);
  });

  test('should navigate keyboard-only through all interactive elements', async ({ page }) => {
    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);
    await expect(auditLogTable(page).getByRole('cell', { name: 'Withdrawal Approved' })).toBeVisible();

    // Start keyboard navigation at the audit section's first control (the
    // action filter); the page header/nav precede it in tab order.
    const filter = actionFilter(page);
    await filter.focus();
    await expect(filter).toBeFocused();

    // Tab moves through the section's toolbar in DOM order
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Export audit log to CSV file' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Clear all audit log entries' })).toBeFocused();

    // Continue tabbing through other elements
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.tagName);
      expect(['SELECT', 'BUTTON', 'INPUT', 'A']).toContain(focused);
    }
  });

  test('should handle pagination', async ({ page }) => {
    // Mock response with more than pageSize entries
    await page.route('**/api/admin/audit-log*', async (route) => {
      const entries = Array.from({ length: 25 }, (_, i) => ({
        id: String(i + 1),
        timestamp: new Date('2026-03-20T10:00:00Z').toISOString(),
        adminAddress: 'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
        action: 'withdrawal_approved' as const,
        parameters: { userId: `user${i}`, amount: 100 },
        result: 'success',
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ 
          entries, 
          page: 1, 
          pageSize: 20, 
          total: 25, 
          totalPages: 2,
          actions: ['withdrawal_approved'] 
        }),
      });
    });

    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // Check pagination controls are visible
    await expect(page.getByRole('button', { name: /go to next page/i })).toBeVisible();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
  });

  test('should display total entries count', async ({ page }) => {
    await gotoAdmin(page);
    await waitForAuditLogLoaded(page);

    // Check total entries display (3 mocked entries)
    await expect(page.getByText('Showing 1-3 of 3')).toBeVisible();
  });
});
