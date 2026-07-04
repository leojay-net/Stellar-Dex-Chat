import { test, expect } from '@playwright/test';
import { mockSorobanRpc, MOCK_WALLET_ADDRESS } from './helpers';

test.describe('Payout Form and Mocked Transfer Initiation', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto('/test-stellar-fiat-modal?mode=withdraw');
    await page.getByRole('dialog', { name: /withdraw from bridge/i }).waitFor({
      state: 'visible',
    });
  });

  test('should open withdraw modal on fixture page', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /withdraw from bridge/i }),
    ).toBeVisible();
  });

  test('should show recipient address field in withdraw mode', async ({
    page,
  }) => {
    await expect(page.getByText(/recipient address/i)).toBeVisible();
    await expect(page.locator('input[placeholder="G..."]')).toBeVisible();
    await expect(page.getByText(/leave blank for self/i)).toBeVisible();
  });

  test('should disable submit for invalid recipient address', async ({
    page,
  }) => {
    await page.locator('input[placeholder="G..."]').fill('invalid-address');
    await page.locator('input[type="number"]').fill('1.0');
    await page.getByRole('button', { name: /^withdraw$/i }).click();
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });

  test('should accept valid Stellar address format', async ({ page }) => {
    await page
      .locator('input[placeholder="G..."]')
      .fill(MOCK_WALLET_ADDRESS);
    await page.locator('input[type="number"]').fill('0.5');
    await expect(page.getByRole('button', { name: /^withdraw$/i })).toBeEnabled();
  });

  test('should allow withdrawal to self when recipient is blank', async ({
    page,
  }) => {
    await page.locator('input[type="number"]').fill('1.0');
    await expect(page.getByRole('button', { name: /^withdraw$/i })).toBeEnabled();
  });

  test('should show success state via demo control', async ({ page }) => {
    await page.getByRole('button', { name: /demo: simulate success/i }).click();
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.getByText('Transaction Confirmed!')).toBeVisible();
  });

  test('should disable submit for empty withdrawal amount', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^withdraw$/i })).toBeDisabled();
  });

  test('should display correct wallet info for withdrawal', async ({ page }) => {
    const walletInfo = page.locator('[data-testid="wallet-info"]');
    await expect(walletInfo).toBeVisible();
    await expect(walletInfo).toContainText(
      new RegExp(MOCK_WALLET_ADDRESS.slice(0, 8)),
    );
    await expect(walletInfo).toContainText(/TESTNET/);
  });

  test('should close modal after success demo', async ({ page }) => {
    await page.getByRole('button', { name: /demo: simulate success/i }).click();
    await page
      .locator('[data-testid="success-message"]')
      .getByRole('button', { name: 'Close' })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Payout Form — disconnected wallet', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto('/test-stellar-fiat-modal?mode=withdraw&connected=false');
    await page.getByRole('dialog', { name: /withdraw from bridge/i }).waitFor({
      state: 'visible',
    });
  });

  test('should disable withdrawal when wallet is not connected', async ({
    page,
  }) => {
    await expect(page.getByRole('button', { name: /^withdraw$/i })).toBeDisabled();
    await expect(
      page.getByText(/connect your freighter wallet to continue/i),
    ).toBeVisible();
  });
});
