import { test, expect } from '@playwright/test';
import { mockSorobanRpc, installMockWalletBridge, connectMockWallet, MOCK_ADMIN_ADDRESS } from './helpers';

test.describe('AuditTable E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Soroban RPC for admin authentication
    await mockSorobanRpc(page, { adminAddress: MOCK_ADMIN_ADDRESS });
    
    // Mock the admin audit-log API route
    await page.route('**/api/admin/audit-log*', async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      
      // Return different responses based on query params for testing different states
      if (url.searchParams.get('error') === 'true') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal server error' }),
        });
        return;
      }

      if (url.searchParams.get('empty') === 'true') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ 
            entries: [], 
            page: 1, 
            pageSize: 20, 
            total: 0, 
            totalPages: 0,
            actions: [] 
          }),
        });
        return;
      }

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
    // Mock a delayed response to show loading state
    await page.route('**/api/admin/audit-log*', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.continue();
    });

    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Check for loading skeleton
    await expect(page.getByText('Loading...')).toBeVisible();
  });

  test('should display empty state', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin?empty=true');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    
    // The audit section should show empty state
    await expect(page.getByText(/no audit entries/i)).toBeVisible();
  });

  test('should display error state', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin?error=true');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    
    // Check for error message in audit section
    await expect(page.getByText(/error/i)).toBeVisible();
  });

  test('should display audit entries in happy path', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Check that audit entries are displayed
    await expect(page.getByText('Withdrawal Approved')).toBeVisible();
    await expect(page.getByText('Withdrawal Rejected')).toBeVisible();
    await expect(page.getByText('Reconciliation Adjustment')).toBeVisible();
  });

  test('should filter by action type', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Select withdrawal_approved filter
    const actionFilter = page.getByRole('combobox').first();
    await actionFilter.selectOption('withdrawal_approved');
    
    // Wait for filtered results
    await expect(page.getByText('Withdrawal Approved')).toBeVisible();
  });

  test('should reset filters', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Apply filter
    const actionFilter = page.getByRole('combobox').first();
    await actionFilter.selectOption('withdrawal_approved');
    
    // Reset filter by selecting 'all'
    await actionFilter.selectOption('all');
    
    // Verify filter is reset - all entries should be visible
    await expect(page.getByText('Withdrawal Approved')).toBeVisible();
    await expect(page.getByText('Withdrawal Rejected')).toBeVisible();
  });

  test('should export CSV', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Click export button
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export/i }).click();
    const download = await downloadPromise;
    
    // Verify download
    expect(download.suggestedFilename()).toMatch(/admin_audit_log_.*\.csv/);
  });

  test('should navigate keyboard-only through all interactive elements', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Tab through interactive elements in the audit section
    await page.keyboard.press('Tab');
    
    // Focus should be on first interactive element (action filter)
    let focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['SELECT', 'BUTTON']).toContain(focused);
    
    // Continue tabbing through other elements
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement?.tagName);
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

    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Check pagination controls are visible
    await expect(page.getByRole('button', { name: /next/i })).toBeVisible();
  });

  test('should display total entries count', async ({ page }) => {
    await installMockWalletBridge(page);
    await page.goto('/admin');
    await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
    
    // Wait for admin dashboard to load
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('Loading...')).toBeHidden();
    
    // Check total entries display
    await expect(page.getByText(/total/i)).toBeVisible();
  });
});
