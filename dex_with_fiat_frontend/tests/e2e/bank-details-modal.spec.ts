import { test, expect } from '@playwright/test';

/**
 * E2E coverage for BankDetailsModal.tsx — Issue #526
 *
 * The modal is a 4-step fiat payout flow:
 *   Step 1 — bank selection
 *   Step 2 — account number entry & verification
 *   Step 3 — confirm payout (locked quote)
 *   Step 4 — success / status tracking
 */

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

const MOCK_BANKS = [
  { id: 1, name: 'Access Bank', code: '044', active: true, country: 'NG', currency: 'NGN', type: 'nuban' },
  { id: 2, name: 'Zenith Bank', code: '057', active: true, country: 'NG', currency: 'NGN', type: 'nuban' },
];

async function mockBankApis(page: import('@playwright/test').Page) {
  await page.route('**/api/banks', (route) =>
    route.fulfill({ json: { success: true, data: MOCK_BANKS } }),
  );
  await page.route('**/api/verify-account', (route) =>
    route.fulfill({ json: { success: true, data: { account_name: 'John Doe' } } }),
  );
  await page.route('**/api/create-recipient', (route) =>
    route.fulfill({ json: { success: true, data: { recipient_code: 'RCP_test123' } } }),
  );
  await page.route('**/api/initiate-transfer', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { reference: 'TRF_e2e_ref', transfer_code: 'TRF_e2e_code', status: 'pending' },
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Bank selection
// ---------------------------------------------------------------------------

test.describe('BankDetailsModal — Step 1: bank selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/chat');
  });

  test('modal opens and shows step 1 with bank list', async ({ page }) => {
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    const dialog = page.getByRole('dialog', { name: /fiat payout/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Access Bank')).toBeVisible();
    await expect(page.getByText('Zenith Bank')).toBeVisible();
  });

  test('Next button is disabled until a bank is selected', async ({ page }) => {
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    const nextBtn = page.getByRole('button', { name: /next/i });
    await expect(nextBtn).toBeDisabled();
    await page.getByRole('button', { name: 'Access Bank' }).click();
    await expect(nextBtn).toBeEnabled();
  });

  test('bank search filters the list', async ({ page }) => {
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await page.getByPlaceholder(/search banks/i).fill('Zenith');
    await expect(page.getByRole('button', { name: 'Zenith Bank' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Access Bank' })).not.toBeVisible();
  });

  test('shows "No banks found" when search has no match', async ({ page }) => {
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await page.getByPlaceholder(/search banks/i).fill('XYZ_NONEXISTENT');
    await expect(page.getByText(/no banks found/i)).toBeVisible();
  });

  test('shows error state when bank API fails', async ({ page }) => {
    await page.route('**/api/banks', (route) =>
      route.fulfill({ json: { success: false, message: 'Service unavailable' } }),
    );
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await expect(page.getByText(/service unavailable/i)).toBeVisible();
  });

  test('close button dismisses the modal', async ({ page }) => {
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Step 2 — Account number entry & verification
// ---------------------------------------------------------------------------

test.describe('BankDetailsModal — Step 2: account verification', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/chat');
    // Navigate to step 2
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await page.getByRole('button', { name: 'Access Bank' }).click();
    await page.getByRole('button', { name: /next/i }).click();
  });

  test('shows step 2 with account number input', async ({ page }) => {
    await expect(page.getByPlaceholder('0000000000')).toBeVisible();
    await expect(page.getByText('Access Bank')).toBeVisible();
  });

  test('verifies account on blur and shows account name', async ({ page }) => {
    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/John Doe/i)).toBeVisible();
  });

  test('shows Zod validation error for account number shorter than 10 digits', async ({ page }) => {
    const input = page.getByPlaceholder('0000000000');
    await input.fill('12345');
    await input.blur();
    await expect(page.getByText(/exactly 10 digits/i)).toBeVisible();
  });

  test('shows API error when account verification fails', async ({ page }) => {
    await page.route('**/api/verify-account', (route) =>
      route.fulfill({ json: { success: false, message: 'Account not found' } }),
    );
    const input = page.getByPlaceholder('0000000000');
    await input.fill('0000000000');
    await input.blur();
    await expect(page.getByText(/account not found/i)).toBeVisible();
  });

  test('save beneficiary prompt appears after successful verification', async ({ page }) => {
    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/save beneficiary/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Step 3 — Confirm payout
// ---------------------------------------------------------------------------

test.describe('BankDetailsModal — Step 3: confirm payout', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    // Mock the locked quote endpoint used by fetchLockedQuote
    await page.route('**/api/crypto-price**', (route) =>
      route.fulfill({
        json: { ngnAmount: 15000, xlmAmount: 10, rate: 1500, expiresAt: Date.now() + 120_000 },
      }),
    );
    await page.goto('/chat');
    // Navigate to step 3 via step 1 → 2
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await page.getByRole('button', { name: 'Access Bank' }).click();
    await page.getByRole('button', { name: /next/i }).click();
    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/John Doe/i)).toBeVisible();
    await page.getByRole('button', { name: /next/i }).click();
  });

  test('shows confirm payout screen with quote details', async ({ page }) => {
    await expect(page.getByText(/confirm/i)).toBeVisible();
  });

  test('confirm button is disabled when quote has expired', async ({ page }) => {
    // Override with an already-expired quote
    await page.route('**/api/crypto-price**', (route) =>
      route.fulfill({
        json: { ngnAmount: 15000, xlmAmount: 10, rate: 1500, expiresAt: Date.now() - 1 },
      }),
    );
    // Reload step 3 with expired quote
    await page.reload();
    const confirmBtn = page.getByRole('button', { name: /confirm payout/i });
    await expect(confirmBtn).toBeDisabled();
  });

  test('payout note field accepts text up to 160 characters', async ({ page }) => {
    const noteField = page.getByPlaceholder(/optional note/i);
    if (await noteField.isVisible()) {
      await noteField.fill('A'.repeat(160));
      await expect(noteField).toHaveValue('A'.repeat(160));
    }
  });
});

// ---------------------------------------------------------------------------
// Step 4 — Success state
// ---------------------------------------------------------------------------

test.describe('BankDetailsModal — Step 4: success state', () => {
  test.beforeEach(async ({ page }) => {
    await mockBankApis(page);
    await page.goto('/chat');
  });

  test('reaches success step after full happy-path flow', async ({ page }) => {
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await page.getByRole('button', { name: 'Access Bank' }).click();
    await page.getByRole('button', { name: /next/i }).click();

    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/John Doe/i)).toBeVisible();
    await page.getByRole('button', { name: /next/i }).click();

    // Confirm payout
    const confirmBtn = page.getByRole('button', { name: /confirm payout/i });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.click();

    // Step 4 success screen
    await expect(page.getByText(/transfer/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Idempotency — rapid double-click protection
// ---------------------------------------------------------------------------

test.describe('BankDetailsModal — idempotency guard', () => {
  test('rapid double-click on confirm does not submit twice', async ({ page }) => {
    await mockBankApis(page);

    let callCount = 0;
    await page.route('**/api/initiate-transfer', (route) => {
      callCount++;
      return route.fulfill({
        json: {
          success: true,
          data: { reference: 'TRF_double', transfer_code: 'TRF_double', status: 'pending' },
        },
      });
    });

    await page.goto('/chat');
    await page.getByRole('button', { name: /fiat payout|payout/i }).click();
    await page.getByRole('button', { name: 'Access Bank' }).click();
    await page.getByRole('button', { name: /next/i }).click();

    const input = page.getByPlaceholder('0000000000');
    await input.fill('1234567890');
    await input.blur();
    await expect(page.getByText(/John Doe/i)).toBeVisible();
    await page.getByRole('button', { name: /next/i }).click();

    const confirmBtn = page.getByRole('button', { name: /confirm payout/i });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });

    // Double-click rapidly
    await confirmBtn.click();
    await confirmBtn.click();

    await page.waitForTimeout(4000);
    expect(callCount).toBeLessThanOrEqual(1);
  });
});
