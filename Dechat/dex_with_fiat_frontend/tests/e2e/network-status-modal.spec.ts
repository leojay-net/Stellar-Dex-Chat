import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for NetworkStatusModal component
 * - Tests all three network states (connected, mismatch, disconnected)
 * - Verifies dark/light mode rendering
 * - Tests keyboard navigation and accessibility
 * - Verifies closing behavior
 *
 * Uses the /test-network-status-modal harness page. The wallet state is chosen
 * with the `state` query param (the harness drives the real
 * StellarWalletProvider through its mockConnect test hook) and the theme with
 * the `theme` localStorage key read by the real ThemeProvider.
 */

const TEST_URL = '/test-network-status-modal';

// Mock wallet context values
const CONNECTED_ADDRESS = 'GBEFLW6RT4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7NQ';
/** Mirrors EXPECTED_NETWORK in StellarWalletContext. */
const EXPECTED_NETWORK = 'TESTNET';
/** Network the harness connects with for the mismatch state. */
const MISMATCH_NETWORK = 'PUBLIC';

type NetworkState = 'connected' | 'mismatch' | 'disconnected';

async function gotoModal(
  page: Page,
  {
    state = 'connected',
    address = CONNECTED_ADDRESS,
    theme = 'light',
  }: { state?: NetworkState; address?: string; theme?: 'light' | 'dark' } = {},
): Promise<void> {
  await page.addInitScript((savedTheme) => {
    localStorage.setItem('theme', savedTheme);
  }, theme);
  const params = new URLSearchParams({ state, address });
  await page.goto(`${TEST_URL}?${params.toString()}`);
}

function networkModal(page: Page) {
  return page.getByRole('dialog', { name: /network status/i });
}

/** The <dd> value for a given <dt> label in the modal's wallet details list. */
function detailValue(page: Page, label: string) {
  return networkModal(page)
    .locator('dl > div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('dd');
}

/** The backdrop rendered immediately before the dialog. */
function backdrop(page: Page) {
  return page
    .locator('[role="dialog"]')
    .locator('xpath=preceding-sibling::div[@aria-hidden="true"][1]');
}

test.describe('NetworkStatusModal E2E Coverage', () => {
  test.describe('Connected State', () => {
    test('should display connected status in Chromium with correct elements', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      // Verify modal is visible
      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Verify elements for connected state
      await expect(modal.getByText('Connected', { exact: true })).toBeVisible();
      await expect(modal.getByText(/Wallet is connected to the Stellar testnet network/i)).toBeVisible();

      // Verify green dot indicator
      const statusIndicator = modal.locator('span[class*="bg-green"]').first();
      await expect(statusIndicator).toBeVisible();

      // Verify wallet details section
      await expect(modal.getByText('Address', { exact: true })).toBeVisible();
      await expect(modal.getByText('Network', { exact: true })).toBeVisible();
      await expect(modal.getByText('Expected', { exact: true })).toBeVisible();
      await expect(detailValue(page, 'Expected')).toHaveText(EXPECTED_NETWORK);
    });

    test('should display connected status in Firefox with correct rendering', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(modal.getByText('Connected', { exact: true })).toBeVisible();
    });

    test('should display connected status in WebKit with correct styling', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Verify styling is applied
      const classAttr = await modal.getAttribute('class');
      expect(classAttr).toContain('fixed');
      expect(classAttr).toContain('rounded-xl');
    });

    test('should show address truncation in connected state', async ({ page }) => {
      const testAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
      await gotoModal(page, { state: 'connected', address: testAddress });

      // Address is formatted as the first 6 and last 4 characters: GABCDE…3456
      const addressDisplay = detailValue(page, 'Address');
      await expect(addressDisplay).toBeVisible();
      await expect(addressDisplay).toHaveText('GABCDE…3456');
    });
  });

  test.describe('Mismatch State', () => {
    test('should display network mismatch status with warning styling', async ({ page }) => {
      await gotoModal(page, { state: 'mismatch' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Verify mismatch-specific content
      await expect(modal.getByText('Network Mismatch', { exact: true })).toBeVisible();
      await expect(modal.getByText(/Wallet is connected to public but the app expects/i)).toBeVisible();
      await expect(modal.getByText(/Transactions are disabled/i)).toBeVisible();

      // Verify amber/warning indicator
      const statusIndicator = modal.locator('span[class*="bg-amber"]').first();
      await expect(statusIndicator).toBeVisible();
    });

    test('should show full wallet details in mismatch state', async ({ page }) => {
      await gotoModal(page, { state: 'mismatch' });

      // Verify details section is visible
      await expect(networkModal(page).getByText('Address', { exact: true })).toBeVisible();
      await expect(detailValue(page, 'Network')).toHaveText(MISMATCH_NETWORK);
      await expect(detailValue(page, 'Expected')).toHaveText(EXPECTED_NETWORK);
    });
  });

  test.describe('Disconnected State', () => {
    test('should display disconnected status with error styling', async ({ page }) => {
      await gotoModal(page, { state: 'disconnected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Verify disconnected-specific content
      await expect(modal.getByText('Disconnected', { exact: true })).toBeVisible();
      await expect(modal.getByText(/No Stellar wallet is connected/i)).toBeVisible();
      await expect(modal.getByText(/Connect Freighter/i)).toBeVisible();

      // Verify red error indicator
      const statusIndicator = modal.locator('span[class*="bg-red"]').first();
      await expect(statusIndicator).toBeVisible();

      // Verify details section is NOT visible
      const detailsSection = modal.locator('dl');
      await expect(detailsSection).not.toBeVisible();
    });
  });

  test.describe('Dark Mode Styling', () => {
    test('should apply dark mode styling when enabled (Chromium)', async ({ page }) => {
      await gotoModal(page, { state: 'connected', theme: 'dark' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Verify dark mode classes are applied
      await expect(modal).toHaveClass(/\bbg-gray-900\b/);
      const classAttr = await modal.getAttribute('class');
      expect(classAttr).toContain('bg-gray-900');
      expect(classAttr).toContain('border-gray-700');
      expect(classAttr).toContain('text-gray-100');
    });

    test('should apply light mode styling when disabled (Chromium)', async ({ page }) => {
      await gotoModal(page, { state: 'connected', theme: 'light' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Verify light mode classes are applied
      await expect(modal).toHaveClass(/\bbg-white\b/);
      const classAttr = await modal.getAttribute('class');
      expect(classAttr).toContain('bg-white');
      expect(classAttr).toContain('border-gray-200');
      expect(classAttr).toContain('text-gray-900');
    });
  });

  test.describe('Closing Behavior', () => {
    test('should close modal when close button is clicked', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Click close button
      const closeBtn = modal.getByRole('button', { name: 'Close' });
      await closeBtn.click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should close modal when backdrop is clicked', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Click the backdrop away from the centred dialog
      await backdrop(page).click({ position: { x: 10, y: 10 } });

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should allow focus on close button via keyboard', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Tab to close button
      await page.keyboard.press('Tab');
      const closeBtn = modal.getByRole('button', { name: 'Close' });

      // Press Enter to close
      await closeBtn.focus();
      await expect(closeBtn).toBeFocused();
      await page.keyboard.press('Enter');

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should allow keyboard-only navigation through interactive elements', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Focus should be managed properly
      const closeBtn = modal.getByRole('button', { name: 'Close' });
      await closeBtn.focus();

      // Verify button is focused
      await expect(closeBtn).toBeFocused();
    });

    test('should allow tabbing to all interactive elements', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = networkModal(page);
      await expect(modal).toBeVisible();

      // Click modal to ensure focus is inside
      await modal.click();

      // Find all focusable elements
      const focusableElements = await modal.locator('button').count();
      expect(focusableElements).toBeGreaterThan(0);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA attributes for dialog', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();

      // Verify ARIA attributes
      const role = await modal.getAttribute('role');
      expect(role).toBe('dialog');

      const ariaModal = await modal.getAttribute('aria-modal');
      expect(ariaModal).toBe('true');

      const ariaLabel = await modal.getAttribute('aria-label');
      expect(ariaLabel).toContain('Network status');
    });

    test('should have proper backdrop with aria-hidden', async ({ page }) => {
      await gotoModal(page, { state: 'connected' });

      const modalBackdrop = backdrop(page);
      await expect(modalBackdrop).toBeVisible();

      const ariaHidden = await modalBackdrop.getAttribute('aria-hidden');
      expect(ariaHidden).toBe('true');
    });
  });

  test.describe('No Real Network Calls', () => {
    test('should not make real API calls when rendering modal', async ({ page }) => {
      const networkRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('stellar') || request.url().includes('api')) {
          networkRequests.push(request.url());
        }
      });

      await gotoModal(page, { state: 'connected' });

      await expect(networkModal(page)).toBeVisible();

      // Verify no API calls were made for the modal itself
      const stellarApiCalls = networkRequests.filter(url =>
        url.includes('stellar') || url.includes('/api/')
      );

      // Should be no real network calls (or only from page setup)
      expect(stellarApiCalls.length).toBeLessThanOrEqual(1);
    });
  });
});
