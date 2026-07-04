import { test, expect } from '@playwright/test';
import { mockSorobanRpc, MOCK_WALLET_ADDRESS } from './helpers';

test.describe('StellarFiatModal E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto('/test-stellar-fiat-modal');
    const dialog = page.getByRole('dialog', { name: /deposit to bridge/i });
    await dialog.waitFor({ state: 'visible' });
    await expect(dialog.locator('input[type="number"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test.describe('Modal Opening and Closing', () => {
    test('should open modal on fixture page', async ({ page }) => {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /deposit to bridge/i }),
      ).toBeVisible();
    });

    test('should close modal when close button is clicked', async ({ page }) => {
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });
  });

  test.describe('Amount Input Validation', () => {
    test('should accept valid amount input', async ({ page }) => {
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('10.5');
      await expect(amountInput).toHaveValue('10.5');
    });

    test('should disable submit for invalid amount', async ({ page }) => {
      await page.locator('input[type="number"]').first().fill('-5');
      await expect(page.getByRole('button', { name: /^deposit$/i })).toBeDisabled();
    });

    test('should disable submit for zero amount', async ({ page }) => {
      await page.locator('input[type="number"]').first().fill('0');
      await expect(page.getByRole('button', { name: /^deposit$/i })).toBeDisabled();
    });

    test('should update amount with preset buttons', async ({ page }) => {
      const dialog = page.getByRole('dialog', { name: /deposit to bridge/i });
      await dialog.getByRole('button', { name: '5', exact: true }).click();
      await expect(dialog.locator('input[type="number"]').first()).toHaveValue('5');
    });
  });

  test.describe('Wallet display', () => {
    test('should show connected wallet info', async ({ page }) => {
      await expect(page.locator('[data-testid="wallet-info"]')).toContainText(
        new RegExp(MOCK_WALLET_ADDRESS.slice(0, 8)),
      );
    });
  });

  test.describe('Withdraw mode', () => {
    test('should render withdraw modal on withdraw fixture page', async ({
      page,
    }) => {
      await page.goto('/test-stellar-fiat-modal?mode=withdraw');
      await expect(
        page.getByRole('heading', { name: /withdraw from bridge/i }),
      ).toBeVisible();
      await expect(page.getByText(/recipient address/i)).toBeVisible();
    });
  });
});
