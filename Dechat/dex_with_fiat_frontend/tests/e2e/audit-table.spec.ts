import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import {
  connectMockWallet,
  fullKeyboardTabKey,
  mockAdminAuthentication,
  MOCK_ADMIN_ADDRESS,
} from './helpers';

const auditLogUrl = '**/api/admin/audit-log?*';
const entries = [
  {
    id: '1',
    timestamp: '2026-03-20T10:00:00Z',
    adminAddress: MOCK_ADMIN_ADDRESS,
    action: 'withdrawal_approved',
    parameters: { userId: 'user123', amount: 100 },
    result: 'success',
  },
  {
    id: '2',
    timestamp: '2026-03-21T14:30:00Z',
    adminAddress: MOCK_ADMIN_ADDRESS,
    action: 'withdrawal_rejected',
    parameters: { userId: 'user456', reason: 'Insufficient funds' },
    result: 'failed',
  },
  {
    id: '3',
    timestamp: '2026-03-22T09:15:00Z',
    adminAddress: MOCK_ADMIN_ADDRESS,
    action: 'reconciliation_adjustment',
    parameters: { adjustmentAmount: 50 },
    result: 'success',
  },
];

async function mockAuditLog(
  page: Page,
  {
    records = entries,
    fail = false,
    wait,
  }: {
    records?: typeof entries;
    fail?: boolean;
    wait?: Promise<void>;
  } = {},
) {
  await page.route(auditLogUrl, async (route) => {
    await wait;
    if (fail) {
      await route.fulfill({ status: 500, json: { error: 'Test failure' } });
      return;
    }

    const params = new URL(route.request().url()).searchParams;
    const action = params.get('action');
    const selected =
      action && action !== 'all'
        ? records.filter((entry) => entry.action === action)
        : records;
    const pageNumber = Number(params.get('page') ?? '1');
    const pageSize = 20;
    await route.fulfill({
      json: {
        entries: selected.slice(
          (pageNumber - 1) * pageSize,
          pageNumber * pageSize,
        ),
        page: pageNumber,
        pageSize,
        total: selected.length,
        totalPages: Math.max(1, Math.ceil(selected.length / pageSize)),
        actions: [...new Set(records.map((entry) => entry.action))],
      },
    });
  });
}

async function openAuditLog(page: Page) {
  await page.goto('/admin');
  await connectMockWallet(page);
  await expect(
    page.getByRole('heading', { name: 'Admin Dashboard' }),
  ).toBeVisible();
}

function table(page: Page) {
  return page.getByRole('table', { name: 'Admin audit log entries' });
}

function actionFilter(page: Page) {
  return page.getByRole('combobox', {
    name: 'Filter admin audit log by action type',
  });
}

test.describe('Admin audit log', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuthentication(page);
    await page.route('**/api/admin/reconciliation', (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/api/admin-audit?*', (route) =>
      route.fulfill({ json: { entries: [], total: 0 } }),
    );
  });

  test('displays loading state', async ({ page }) => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockAuditLog(page, { wait });
    try {
      await openAuditLog(page);
      await expect(
        page.getByText('Loading audit entries...', { exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
    await expect(
      table(page).getByRole('cell', { name: 'Withdrawal Approved' }),
    ).toBeVisible();
  });

  test('displays empty state', async ({ page }) => {
    await mockAuditLog(page, { records: [] });
    await openAuditLog(page);
    await expect(
      page.getByText('No audit entries found for the selected action type.'),
    ).toBeVisible();
  });

  test('displays error state', async ({ page }) => {
    await mockAuditLog(page, { fail: true });
    await openAuditLog(page);
    await expect(
      page
        .getByRole('alert')
        .getByText('Failed to fetch admin audit logs (500)'),
    ).toBeVisible();
  });

  test('displays audit entries', async ({ page }) => {
    await mockAuditLog(page);
    await openAuditLog(page);
    for (const label of [
      'Withdrawal Approved',
      'Withdrawal Rejected',
      'Reconciliation Adjustment',
    ]) {
      await expect(
        table(page).getByRole('cell', { name: label }),
      ).toBeVisible();
    }
  });

  test('filters entries by action type', async ({ page }) => {
    await mockAuditLog(page);
    await openAuditLog(page);
    await actionFilter(page).selectOption('withdrawal_approved');
    await expect(
      table(page).getByRole('cell', { name: 'Withdrawal Approved' }),
    ).toBeVisible();
    await expect(
      table(page).getByRole('cell', { name: 'Withdrawal Rejected' }),
    ).toHaveCount(0);
  });

  test('resets the action filter', async ({ page }) => {
    await mockAuditLog(page);
    await openAuditLog(page);
    await actionFilter(page).selectOption('withdrawal_approved');
    await expect(
      table(page).getByRole('cell', { name: 'Withdrawal Rejected' }),
    ).toHaveCount(0);
    await actionFilter(page).selectOption('all');
    await expect(
      table(page).getByRole('cell', { name: 'Withdrawal Approved' }),
    ).toBeVisible();
    await expect(
      table(page).getByRole('cell', { name: 'Withdrawal Rejected' }),
    ).toBeVisible();
  });

  test('exports CSV', async ({ page }) => {
    await mockAuditLog(page);
    await openAuditLog(page);
    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export audit log to CSV file' })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/admin_audit_log_.*\.csv/);
  });

  test('reaches audit controls with the keyboard', async ({
    page,
    browserName,
  }) => {
    await mockAuditLog(page);
    await openAuditLog(page);
    await table(page)
      .getByRole('cell', { name: 'Withdrawal Approved' })
      .waitFor();
    const tabKey = fullKeyboardTabKey(browserName);
    await actionFilter(page).focus();
    await page.keyboard.press(tabKey);
    await expect(
      page.getByRole('button', { name: 'Export audit log to CSV file' }),
    ).toBeFocused();
    await page.keyboard.press(tabKey);
    // Firefox can focus the horizontal scroll container before the first cell.
    const scrollContainer = table(page).locator('..');
    if (
      await scrollContainer.evaluate((node) => node === document.activeElement)
    ) {
      await page.keyboard.press(tabKey);
    }
    await expect(
      table(page).getByRole('button', { name: 'Copy timestamp' }).first(),
    ).toBeFocused();
  });

  test('loads the next page of audit entries', async ({ page }) => {
    const records = Array.from({ length: 25 }, (_, index) => ({
      ...entries[0],
      id: String(index + 1),
      parameters: { userId: `user-${index}`, amount: 100 },
    }));
    await mockAuditLog(page, { records });
    await openAuditLog(page);
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await page.getByRole('button', { name: /Go to next page/ }).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(table(page).getByText(/user-24/)).toBeVisible();
    await expect(table(page).locator('tbody tr')).toHaveCount(5);
  });

  test('displays the total number of audit entries', async ({ page }) => {
    await mockAuditLog(page);
    await openAuditLog(page);
    await expect(
      page.getByText('Showing 1-3 of 3', { exact: true }),
    ).toBeVisible();
  });
});
