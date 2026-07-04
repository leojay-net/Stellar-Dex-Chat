import { test, expect } from '@playwright/test';
import { mockSorobanRpc, MOCK_WALLET_ADDRESS } from './helpers';

test.describe('Deposit Modal Validation and Success State', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto('/test-stellar-fiat-modal');
    const dialog = page.getByRole('dialog', { name: /deposit to bridge/i });
    await dialog.waitFor({ state: 'visible' });
    await expect(dialog.locator('input[type="number"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('should open deposit modal on fixture page', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /deposit to bridge/i }),
    ).toBeVisible();
  });

  test('should disable submit for empty amount', async ({ page }) => {
    const submitButton = page.getByRole('button', { name: /^deposit$/i });
    await expect(submitButton).toBeDisabled();
  });

  test('should disable submit for negative amount', async ({ page }) => {
    await page.locator('input[type="number"]').fill('-1');
    await expect(page.getByRole('button', { name: /^deposit$/i })).toBeDisabled();
  });

  test('should disable submit for zero amount', async ({ page }) => {
    await page.locator('input[type="number"]').fill('0');
    await expect(page.getByRole('button', { name: /^deposit$/i })).toBeDisabled();
  });

  test('should accept valid amount input', async ({ page }) => {
    const amountInput = page.locator('input[type="number"]');
    await amountInput.fill('1.5');
    await expect(amountInput).toHaveValue('1.5');
  });

  test('should show success state via demo control', async ({ page }) => {
    await page.getByRole('button', { name: /demo: simulate success/i }).click();
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.getByText('Transaction Confirmed!')).toBeVisible();
  });

  test('should close modal when close button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should display wallet connection info in modal', async ({ page }) => {
    const walletInfo = page.locator('[data-testid="wallet-info"]');
    await expect(walletInfo).toBeVisible();
    await expect(walletInfo).toContainText(
      new RegExp(MOCK_WALLET_ADDRESS.slice(0, 8)),
    );
    await expect(walletInfo).toContainText(/TESTNET/);
  });
});

test.describe('Deposit Modal — disconnected wallet', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto('/test-stellar-fiat-modal?connected=false');
    await page.getByRole('dialog', { name: /deposit to bridge/i }).waitFor({
      state: 'visible',
    });
  });

  test('should disable submit button when wallet is not connected', async ({
    page,
  }) => {
    await expect(page.getByRole('button', { name: /^deposit$/i })).toBeDisabled();
    await expect(
      page.getByText(/connect your freighter wallet to continue/i),
    ).toBeVisible();
  });
});
