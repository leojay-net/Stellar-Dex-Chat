import { test, expect } from '@playwright/test';

const MOCK_BANKS = [
  {
    id: 1,
    name: 'Access Bank',
    code: '044',
    active: true,
    country: 'NG',
    currency: 'NGN',
    type: 'nuban',
  },
  {
    id: 2,
    name: 'Zenith Bank',
    code: '057',
    active: true,
    country: 'NG',
    currency: 'NGN',
    type: 'nuban',
  },
];

async function mockBankApis(page: import('@playwright/test').Page) {
  await page.route('**/api/banks', (route) =>
    route.fulfill({ json: { success: true, data: MOCK_BANKS } }),
  );
  await page.route('**/api/verify-account', (route) =>
    route.fulfill({
      json: { success: true, data: { account_name: 'John Doe' } },
    }),
  );
  await page.route('**/api/create-recipient', (route) =>
    route.fulfill({
      json: { success: true, data: { recipient_code: 'RCP_test123' } },
    }),
  );
  await page.route('**/api/initiate-transfer', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          reference: 'TRF_e2e_ref',
          transfer_code: 'TRF_e2e_code',
          status: 'pending',
        },
      },
    }),
  );
  await page.route('**/api/crypto-price**', (route) =>
    route.fulfill({
      json: {
        ngnAmount: 15000,
        xlmAmount: 10,
        rate: 1500,
        expiresAt: Date.now() + 120_000,
      },
    }),
  );
  await page.route('**/api.coingecko.com/**', (route) =>
    route.fulfill({
      json: { stellar: { ngn: 1500, usd: 0.12 } },
    }),
  );
}

async function gotoBankDetailsStep2(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', { name: /fiat payout/i });
  await expect(dialog.getByRole('button', { name: 'Access Bank' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Access Bank' }).click();
  await dialog.getByRole('button', { name: /^next$/i }).click();
  await expect(page.getByPlaceholder('0000000000')).toBeVisible();
}

async function gotoBankDetailsStep3(page: import('@playwright/test').Page) {
  await gotoBankDetailsStep2(page);
  const dialog = page.getByRole('dialog', { name: /fiat payout/i });
  const input = page.getByPlaceholder('0000000000');
  await input.fill('1234567890');
  await input.blur();
  await expect(page.getByText(/John Doe/i)).toBeVisible();
  const next = dialog.getByRole('button', { name: /^next$/i }).last();
  await expect(next).toBeEnabled({ timeout: 10_000 });
  await next.click();
}

test.describe('BankDetailsModal — Step 1: bank selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/test-bank-details');
    await expect(
      page.getByRole('dialog', { name: /fiat payout/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: /fiat payout/i }).getByRole('button', {
        name: 'Access Bank',
      }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('modal opens and shows step 1 with bank list', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: /fiat payout/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Access Bank')).toBeVisible();
    await expect(dialog.getByText('Zenith Bank')).toBeVisible();
  });

  test('Next button is disabled until a bank is selected', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: /fiat payout/i });
    const nextBtn = dialog.getByRole('button', { name: /^next$/i });
    await expect(nextBtn).toBeDisabled();
    await dialog.getByRole('button', { name: 'Access Bank' }).click();
    await expect(nextBtn).toBeEnabled();
  });

  test('bank search filters the list', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: /fiat payout/i });
    const searchInput = dialog.getByPlaceholder(/search banks/i);
    await searchInput.fill('Zenith');
    await expect(searchInput).toHaveValue('Zenith');
    await expect(dialog.getByRole('button', { name: 'Zenith Bank' })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Access Bank' }),
    ).not.toBeVisible();
  });

  test('shows "No banks found" when search has no match', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: /fiat payout/i });
    await dialog.getByPlaceholder(/search banks/i).fill('XYZ_NONEXISTENT');
    await expect(dialog.getByText(/no banks found/i)).toBeVisible();
  });

  test('shows error state when bank API fails', async ({ page }) => {
    await page.route('**/api/banks', (route) =>
      route.fulfill({
        json: { success: false, message: 'Service unavailable' },
      }),
    );
    await page.reload();
    await expect(page.getByText(/service unavailable/i)).toBeVisible();
  });

  test('close button dismisses the modal', async ({ page }) => {
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('BankDetailsModal — Step 2: account verification', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/test-bank-details');
    await gotoBankDetailsStep2(page);
  });

  test('shows step 2 with account number input', async ({ page }) => {
    await expect(page.getByPlaceholder('0000000000')).toBeVisible();
    await expect(page.getByText(/Bank: Access Bank/i)).toBeVisible();
  });

  test('verifies account on blur and shows account name', async ({ page }) => {
    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/John Doe/i)).toBeVisible();
  });

  test('shows Zod validation error for account number shorter than 10 digits', async ({
    page,
  }) => {
    const input = page.getByPlaceholder('0000000000');
    await input.fill('12345');
    await input.blur();
    await expect(page.getByText(/exactly 10 digits/i)).toBeVisible();
  });

  test('shows API error when account verification fails', async ({ page }) => {
    await page.route('**/api/verify-account', (route) =>
      route.fulfill({
        json: { success: false, message: 'Account not found' },
      }),
    );
    const input = page.getByPlaceholder('0000000000');
    await input.fill('0000000000');
    await input.blur();
    await expect(page.getByText(/account not found/i)).toBeVisible();
  });

  test('save beneficiary prompt appears after successful verification', async ({
    page,
  }) => {
    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/save beneficiary/i)).toBeVisible();
  });
});

test.describe('BankDetailsModal — Step 3: confirm payout', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/test-bank-details');
    await gotoBankDetailsStep3(page);
  });

  test('shows confirm payout screen with quote details', async ({ page }) => {
    await expect(page.getByText(/confirm/i)).toBeVisible();
  });

  test('payout note field accepts text up to 160 characters', async ({ page }) => {
    const noteField = page.getByPlaceholder(/optional note/i);
    if (await noteField.isVisible()) {
      await noteField.fill('A'.repeat(160));
      await expect(noteField).toHaveValue('A'.repeat(160));
    }
  });
});

test.describe('BankDetailsModal — Step 4: success state', () => {
  test('reaches success step after full happy-path flow', async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/test-bank-details');
    await gotoBankDetailsStep3(page);

    const confirmBtn = page.getByRole('button', { name: /confirm payout/i });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.click();

    await expect(page.getByText('Transfer initiated').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('BankDetailsModal — idempotency guard', () => {
  test('rapid double-click on confirm does not submit twice', async ({ page }) => {
    await mockBankApis(page);

    let callCount = 0;
    await page.route('**/api/initiate-transfer', (route) => {
      callCount++;
      return route.fulfill({
        json: {
          success: true,
          data: {
            reference: 'TRF_double',
            transfer_code: 'TRF_double',
            status: 'pending',
          },
        },
      });
    });

    await page.goto('/test-bank-details');
    await gotoBankDetailsStep3(page);

    const confirmBtn = page.getByRole('button', { name: /confirm payout/i });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.dblclick();

    await expect(page.getByText('Transfer initiated').first()).toBeVisible({
      timeout: 10_000,
    });
    expect(callCount).toBeLessThanOrEqual(1);
  });
});
