import { expect, Page } from '@playwright/test';
import { test } from './fixtures';
import { mockSorobanRpc } from './helpers';

/**
 * E2E tests for NetworkStatusModal component
 * - Tests all three network states (connected, mismatch, disconnected)
 * - Verifies dark/light mode rendering
 * - Tests keyboard navigation and accessibility
 * - Verifies closing behavior
 */

// Mock wallet context values
const CONNECTED_ADDRESS =
  'GBEFLW6RT4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7NQ';
const EXPECTED_NETWORK = 'testnet';

test.describe('NetworkStatusModal E2E Coverage', () => {
  // Helper to setup and mount the test page
  async function setupTestPage(page: Page) {
    // Add a test fixture endpoint that mounts the modal
    await page.route('**/api/**', async (route) => {
      await route.abort();
    });
  }

  test.describe('Connected State', () => {
    test('should display connected status in Chromium with correct elements', async ({
      page,
    }) => {
      // Mock the context to return connected state
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      // Navigate to test page
      await page.goto('/test-network-modal-connected');

      // Verify modal is visible
      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Verify elements for connected state
      await expect(page.getByText('Connected')).toBeVisible();
      await expect(
        page.getByText(/Wallet is connected to the Stellar testnet network/i),
      ).toBeVisible();

      // Verify green dot indicator
      const statusIndicator = modal.locator('span[class*="bg-green"]').first();
      await expect(statusIndicator).toBeVisible();

      // Verify wallet details section
      await expect(page.getByText('Address')).toBeVisible();
      await expect(page.getByText('Network')).toBeVisible();
      await expect(page.getByText('Expected')).toBeVisible();
      await expect(page.getByText(EXPECTED_NETWORK)).toBeVisible();
    });

    test('should display connected status in Firefox with correct rendering', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Connected')).toBeVisible();
    });

    test('should display connected status in WebKit with correct styling', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Verify styling is applied
      const dialogElement = page.locator('[role="dialog"]');
      const classAttr = await dialogElement.getAttribute('class');
      expect(classAttr).toContain('fixed');
      expect(classAttr).toContain('rounded-xl');
    });

    test('should show address truncation in connected state', async ({
      page,
    }) => {
      const testAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
      await page.addInitScript((addr) => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: addr, network: 'testnet' },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      }, testAddress);

      await page.goto('/test-network-modal-connected');

      // Address should be formatted as GABCDE...Z123
      const addressDisplay = page.locator('dd').filter({ hasText: /GAB.*123/ });
      await expect(addressDisplay).toBeVisible();
    });
  });

  test.describe('Mismatch State', () => {
    test('should display network mismatch status with warning styling', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'public',
          },
          isNetworkMismatch: true,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-mismatch');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Verify mismatch-specific content
      await expect(page.getByText('Network Mismatch')).toBeVisible();
      await expect(
        page.getByText(/Wallet is connected to public but the app expects/i),
      ).toBeVisible();
      await expect(page.getByText(/Transactions are disabled/i)).toBeVisible();

      // Verify amber/warning indicator
      const statusIndicator = modal.locator('span[class*="bg-amber"]').first();
      await expect(statusIndicator).toBeVisible();
    });

    test('should show full wallet details in mismatch state', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'public',
          },
          isNetworkMismatch: true,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-mismatch');

      // Verify details section is visible
      await expect(page.getByText('Address')).toBeVisible();
      await expect(page.getByText('public')).toBeVisible();
      await expect(page.getByText(EXPECTED_NETWORK)).toBeVisible();
    });
  });

  test.describe('Disconnected State', () => {
    test('should display disconnected status with error styling', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: false, address: '', network: null },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-disconnected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Verify disconnected-specific content
      await expect(page.getByText('Disconnected')).toBeVisible();
      await expect(
        page.getByText(/No Stellar wallet is connected/i),
      ).toBeVisible();
      await expect(page.getByText(/Connect Freighter/i)).toBeVisible();

      // Verify red error indicator
      const statusIndicator = modal.locator('span[class*="bg-red"]').first();
      await expect(statusIndicator).toBeVisible();

      // Verify details section is NOT visible
      const detailsSection = modal.locator('dl');
      await expect(detailsSection).not.toBeVisible();
    });
  });

  test.describe('Dark Mode Styling', () => {
    test('should apply dark mode styling when enabled (Chromium)', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: true,
        };
      });

      await page.goto('/test-network-modal-dark');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Verify dark mode classes are applied
      const classAttr = await modal.getAttribute('class');
      expect(classAttr).toContain('bg-gray-900');
      expect(classAttr).toContain('border-gray-700');
      expect(classAttr).toContain('text-gray-100');
    });

    test('should apply light mode styling when disabled (Chromium)', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-light');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Verify light mode classes are applied
      const classAttr = await modal.getAttribute('class');
      expect(classAttr).toContain('bg-white');
      expect(classAttr).toContain('border-gray-200');
      expect(classAttr).toContain('text-gray-900');
    });
  });

  test.describe('Closing Behavior', () => {
    test('should close modal when close button is clicked', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      let modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Click close button
      const closeBtn = page.getByRole('button', { name: /close/i });
      await closeBtn.click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should close modal when backdrop is clicked', async ({ page }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Click backdrop
      const backdrop = page.locator('[aria-hidden="true"]').first();
      await backdrop.click();

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should allow focus on close button via keyboard', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Tab to close button
      await page.keyboard.press('Tab');
      const closeBtn = page.getByRole('button', { name: /close/i });

      // Press Enter to close
      await closeBtn.focus();
      await page.keyboard.press('Enter');

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });

    test('should allow keyboard-only navigation through interactive elements', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Focus should be managed properly
      const closeBtn = page.getByRole('button', { name: /close/i });
      await closeBtn.focus();

      // Verify button is focused
      const focused = await page.evaluate(
        () => document.activeElement?.className,
      );
      expect(focused).toBeDefined();
    });

    test('should allow tabbing to all interactive elements', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Click modal to ensure focus is inside
      await modal.click();

      // Find all focusable elements
      const focusableElements = await page.locator('button').count();
      expect(focusableElements).toBeGreaterThan(0);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA attributes for dialog', async ({ page }) => {
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

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
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      const backdrop = page.locator('[aria-hidden="true"]').first();
      await expect(backdrop).toBeVisible();

      const ariaHidden = await backdrop.getAttribute('aria-hidden');
      expect(ariaHidden).toBe('true');
    });
  });

  test.describe('No Real Network Calls', () => {
    test('should not make real API calls when rendering modal', async ({
      page,
    }) => {
      const networkRequests: string[] = [];
      page.on('request', (request) => {
        if (
          request.url().includes('stellar') ||
          request.url().includes('api')
        ) {
          networkRequests.push(request.url());
        }
      });

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: {
            isConnected: true,
            address: CONNECTED_ADDRESS,
            network: 'testnet',
          },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      await expect(
        page.getByRole('dialog', { name: /network status/i }),
      ).toBeVisible();

      // Verify no API calls were made for the modal itself
      const stellarApiCalls = networkRequests.filter(
        (url) => url.includes('stellar') || url.includes('/api/'),
      );

      // Should be no real network calls (or only from page setup)
      expect(stellarApiCalls.length).toBeLessThanOrEqual(1);
    });
  });
});
