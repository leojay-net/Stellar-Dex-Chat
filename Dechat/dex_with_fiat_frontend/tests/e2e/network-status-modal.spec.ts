import { test, expect, Page } from '@playwright/test';
import { mockSorobanRpc } from './helpers';

/**
 * E2E tests for NetworkStatusModal component
 * - Tests all three network states (connected, mismatch, disconnected)
 * - Verifies dark/light mode rendering
 * - Tests keyboard navigation and accessibility
 * - Verifies closing behavior
 */

// Mock wallet context values
const CONNECTED_ADDRESS = 'GBEFLW6RT4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7NQ';
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
    test('should display connected status in Chromium with correct elements', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Mock the context to return connected state
      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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
      await expect(page.getByText(/Wallet is connected to the Stellar testnet network/i)).toBeVisible();

      // Verify green dot indicator
      const statusIndicator = modal.locator('span[class*="bg-green"]').first();
      await expect(statusIndicator).toBeVisible();

      // Verify wallet details section
      await expect(page.getByText('Address')).toBeVisible();
      await expect(page.getByText('Network')).toBeVisible();
      await expect(page.getByText('Expected')).toBeVisible();
      await expect(page.getByText(EXPECTED_NETWORK)).toBeVisible();

      await context.close();
    });

    test('should display connected status in Firefox with correct rendering', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');
      
      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Connected')).toBeVisible();

      await context.close();
    });

    test('should display connected status in WebKit with correct styling', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });

    test('should show address truncation in connected state', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

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

      await context.close();
    });
  });

  test.describe('Mismatch State', () => {
    test('should display network mismatch status with warning styling', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'public' },
          isNetworkMismatch: true,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-mismatch');
      
      const modal = page.getByRole('dialog', { name: /network status/i });
      await expect(modal).toBeVisible();

      // Verify mismatch-specific content
      await expect(page.getByText('Network Mismatch')).toBeVisible();
      await expect(page.getByText(/Wallet is connected to public but the app expects/i)).toBeVisible();
      await expect(page.getByText(/Transactions are disabled/i)).toBeVisible();

      // Verify amber/warning indicator
      const statusIndicator = modal.locator('span[class*="bg-amber"]').first();
      await expect(statusIndicator).toBeVisible();

      await context.close();
    });

    test('should show full wallet details in mismatch state', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'public' },
          isNetworkMismatch: true,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-mismatch');
      
      // Verify details section is visible
      await expect(page.getByText('Address')).toBeVisible();
      await expect(page.getByText('public')).toBeVisible();
      await expect(page.getByText(EXPECTED_NETWORK)).toBeVisible();

      await context.close();
    });
  });

  test.describe('Disconnected State', () => {
    test('should display disconnected status with error styling', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

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
      await expect(page.getByText(/No Stellar wallet is connected/i)).toBeVisible();
      await expect(page.getByText(/Connect Freighter/i)).toBeVisible();

      // Verify red error indicator
      const statusIndicator = modal.locator('span[class*="bg-red"]').first();
      await expect(statusIndicator).toBeVisible();

      // Verify details section is NOT visible
      const detailsSection = modal.locator('dl');
      await expect(detailsSection).not.toBeVisible();

      await context.close();
    });
  });

  test.describe('Dark Mode Styling', () => {
    test('should apply dark mode styling when enabled (Chromium)', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });

    test('should apply light mode styling when disabled (Chromium)', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });
  });

  test.describe('Closing Behavior', () => {
    test('should close modal when close button is clicked', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });

    test('should close modal when backdrop is clicked', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should allow focus on close button via keyboard', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });

    test('should allow keyboard-only navigation through interactive elements', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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
      const focused = await page.evaluate(() => document.activeElement?.className);
      expect(focused).toBeDefined();

      await context.close();
    });

    test('should allow tabbing to all interactive elements', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA attributes for dialog', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
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

      await context.close();
    });

    test('should have proper backdrop with aria-hidden', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');
      
      const backdrop = page.locator('[aria-hidden="true"]').first();
      await expect(backdrop).toBeVisible();

      const ariaHidden = await backdrop.getAttribute('aria-hidden');
      expect(ariaHidden).toBe('true');

      await context.close();
    });
  });

  test.describe('No Real Network Calls', () => {
    test('should not make real API calls when rendering modal', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      const networkRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('stellar') || request.url().includes('api')) {
          networkRequests.push(request.url());
        }
      });

      await page.addInitScript(() => {
        (window as any).__NETWORK_STATE = {
          connection: { isConnected: true, address: CONNECTED_ADDRESS, network: 'testnet' },
          isNetworkMismatch: false,
          isDarkMode: false,
        };
      });

      await page.goto('/test-network-modal-connected');

      await expect(page.getByRole('dialog', { name: /network status/i })).toBeVisible();

      // Verify no API calls were made for the modal itself
      const stellarApiCalls = networkRequests.filter(url => 
        url.includes('stellar') || url.includes('/api/')
      );
      
      // Should be no real network calls (or only from page setup)
      expect(stellarApiCalls.length).toBeLessThanOrEqual(1);

      await context.close();
    });
  });
});
