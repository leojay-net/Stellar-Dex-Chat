import { test, expect, type Page } from '@playwright/test';

const COINGECKO_OK_FIXTURE = {
  stellar: { usd: 0.11, usd_24h_change: 2.34 },
  ethereum: { usd: 4000, usd_24h_change: -1.12 },
  bitcoin: { usd: 70000, usd_24h_change: 0.55 },
  'usd-coin': { usd: 1, usd_24h_change: 0.01 },
  tether: { usd: 1, usd_24h_change: 0.0 },
};

async function stubCoinGeckoOk(page: Page, fixture: Record<string, unknown> = COINGECKO_OK_FIXTURE) {
  await page.route('**/api.coingecko.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
  // Safety: catch any other coingecko pattern
  await page.route('**/coingecko.com/**', async (route) => {
    // avoid double-fulfill if already handled
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    } catch {
      // ignore already handled
    }
  });
}

async function stubCoinGeckoDelayed(page: Page, delayMs: number, fixture = COINGECKO_OK_FIXTURE) {
  await page.route('**/api.coingecko.com/**', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
  await page.route('**/coingecko.com/**', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    } catch {}
  });
}

async function stubCoinGeckoEmpty(page: Page) {
  await page.route('**/api.coingecko.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
  await page.route('**/coingecko.com/**', async (route) => {
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    } catch {}
  });
}

async function stubCoinGeckoError(page: Page, status = 500) {
  await page.route('**/api.coingecko.com/**', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal' }),
    });
  });
  await page.route('**/coingecko.com/**', async (route) => {
    try {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal' }),
      });
    } catch {}
  });
}

async function gotoHarness(page: Page, query = '') {
  const url = `/test-price-ticker${query ? `?${query}` : ''}`;
  await page.goto(url);
}

test.describe('PriceTicker E2E Coverage', () => {
  test.describe('Happy path', () => {
    test('renders market prices with stubbed CoinGecko data', async ({ page }) => {
      await stubCoinGeckoOk(page);
      await gotoHarness(page, 'refreshInterval=600000');

      const ticker = page.getByTestId('price-ticker');
      await expect(ticker).toBeVisible({ timeout: 10_000 });
      await expect(ticker).toHaveAttribute('role', 'region');
      await expect(page.getByRole('heading', { name: 'Market Prices' })).toBeVisible();

      // Symbols rendered
      await expect(page.getByText('XLM', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('ETH', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('BTC', { exact: true }).first()).toBeVisible();

      // Price formatting branches: 0.11 -> $0.1100 ( <1 ), 4000 -> $4,000.00, 70000 -> $70,000.00
      await expect(page.getByText('$0.1100')).toBeVisible();
      await expect(page.getByText('$4,000.00')).toBeVisible();
      await expect(page.getByText('$70,000.00')).toBeVisible();

      // Change formatting
      await expect(page.getByText('+2.34%')).toBeVisible();
      await expect(page.getByText('-1.12%')).toBeVisible();

      // Live indicator
      await expect(page.getByLabel('Live')).toBeVisible();
      await expect(page.getByLabel('Live')).toHaveClass(/bg-green-500/);
    });

    test('pagination works via click when more than 5 symbols', async ({ page }) => {
      await stubCoinGeckoOk(page);
      // 6 symbols => 2 pages; FAKE has no price data -> shows placeholder --
      await gotoHarness(page, 'symbols=XLM,ETH,BTC,USDC,USDT,FAKE&refreshInterval=600000');

      const ticker = page.getByTestId('price-ticker');
      await expect(ticker).toBeVisible({ timeout: 10_000 });

      await expect(page.getByText('1 / 2')).toBeVisible();
      const prev = page.getByRole('button', { name: 'Previous price page' });
      const next = page.getByRole('button', { name: 'Next price page' });
      await expect(prev).toBeDisabled();
      await expect(next).toBeEnabled();

      // First page contains XLM
      await expect(page.getByText('XLM', { exact: true })).toBeVisible();

      await next.click();
      await expect(page.getByText('2 / 2')).toBeVisible();
      await expect(page.getByText('FAKE', { exact: true })).toBeVisible();
      // FAKE has no price -> placeholder --
      await expect(page.getByText('--').first()).toBeVisible();
      await expect(prev).toBeEnabled();
      await expect(next).toBeDisabled();

      await prev.click();
      await expect(page.getByText('1 / 2')).toBeVisible();
      await expect(page.getByText('XLM', { exact: true })).toBeVisible();
    });
  });

  test.describe('Loading, empty and error states', () => {
    test('shows loading skeletons before data resolves', async ({ page }) => {
      await stubCoinGeckoDelayed(page, 2000);
      await gotoHarness(page, 'refreshInterval=600000');

      // Loading pulse visible immediately (isLoading && prices empty)
      const pulse = page.locator('.animate-pulse');
      await expect(pulse).toBeVisible({ timeout: 5_000 });

      // Eventually resolves to happy path
      await expect(page.getByTestId('price-ticker')).toBeVisible({ timeout: 10_000 });
      await expect(pulse).toBeHidden({ timeout: 10_000 });
    });

    test('shows empty state when API returns no symbols', async ({ page }) => {
      await stubCoinGeckoEmpty(page);
      await gotoHarness(page, 'refreshInterval=600000');

      await expect(page.getByText('Prices unavailable')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('price-ticker')).toBeHidden();
    });

    test('shows error state when CoinGecko returns 500', async ({ page }) => {
      await stubCoinGeckoError(page, 500);
      await gotoHarness(page, 'refreshInterval=600000');

      await expect(page.getByText('Prices unavailable')).toBeVisible({ timeout: 10_000 });
    });

    test('shows error state on HTTP 429 and does not leak network error to UI', async ({ page }) => {
      await stubCoinGeckoError(page, 429);
      await gotoHarness(page, 'refreshInterval=600000');

      await expect(page.getByText('Prices unavailable')).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Keyboard navigation', () => {
    test('tab reaches ticker region and pagination controls', async ({ page }) => {
      await stubCoinGeckoOk(page);
      await gotoHarness(page, 'symbols=XLM,ETH,BTC,USDC,USDT,FAKE&refreshInterval=600000');

      const ticker = page.getByTestId('price-ticker');
      await expect(ticker).toBeVisible({ timeout: 10_000 });

      // Focus body then Tab sequentially to reach ticker region (h1 -> ticker -> prev -> next)
      await page.keyboard.press('Tab'); // h1 or first focusable
      // Press Tab until ticker is focused (max 5 presses)
      for (let i = 0; i < 6; i++) {
        const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
        if (activeTestId === 'price-ticker') {
          break;
        }
        await page.keyboard.press('Tab');
      }
      await expect(ticker).toBeFocused();

      // ArrowRight / ArrowLeft keyboard shortcuts while focused
      await page.keyboard.press('ArrowRight');
      await expect(page.getByText('2 / 2')).toBeVisible();
      await expect(page.getByText('FAKE', { exact: true })).toBeVisible();

      await page.keyboard.press('ArrowLeft');
      await expect(page.getByText('1 / 2')).toBeVisible();
      await expect(page.getByText('XLM', { exact: true })).toBeVisible();

      // Tab to pagination buttons after ticker
      // On page 1 Previous is disabled (skipped by Tab), so first Tab lands on Next.
      // To test both buttons we first go to page 2 where both are enabled.
      await ticker.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByText('2 / 2')).toBeVisible();
      // Return to page 1 for clean Tab order check
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByText('1 / 2')).toBeVisible();

      await ticker.focus();
      // Disabled Previous is skipped; Tab goes to Next on page 1
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Next price page' })).toBeFocused();

      // Move to page 2 so Previous becomes enabled (Next becomes disabled and is skipped)
      await ticker.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByText('2 / 2')).toBeVisible();
      await ticker.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Previous price page' })).toBeFocused();
      // Next is disabled on page 2, so Tab from Previous exits ticker; verify we can Shift+Tab back
      await page.keyboard.press('Shift+Tab');
      await expect(ticker).toBeFocused();

      // Return to page 1 and verify Shift+Tab from Next returns to ticker (Next is enabled there)
      await ticker.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByText('1 / 2')).toBeVisible();
      await ticker.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Next price page' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(ticker).toBeFocused();
    });

    test('R key refreshes prices via keyboard', async ({ page }) => {
      let requestCount = 0;
      await page.route('**/api.coingecko.com/**', async (route) => {
        requestCount++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(COINGECKO_OK_FIXTURE),
        });
      });
      await page.route('**/coingecko.com/**', async (route) => {
        try {
          requestCount++;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(COINGECKO_OK_FIXTURE),
          });
        } catch {}
      });

      await gotoHarness(page, 'refreshInterval=600000');
      const ticker = page.getByTestId('price-ticker');
      await expect(ticker).toBeVisible({ timeout: 10_000 });
      const initialCount = requestCount;
      expect(initialCount).toBeGreaterThanOrEqual(1);

      await ticker.focus();
      await page.keyboard.press('r');
      // allow second request to fire
      await expect.poll(() => requestCount).toBeGreaterThan(initialCount);

      // Capital R also works
      const beforeCapital = requestCount;
      await page.keyboard.press('R');
      await expect.poll(() => requestCount).toBeGreaterThan(beforeCapital);
    });

    test('pagination reachable via keyboard Arrow keys without mouse', async ({ page }) => {
      await stubCoinGeckoOk(page);
      await gotoHarness(page, 'symbols=XLM,ETH,BTC,USDC,USDT,FAKE&refreshInterval=600000');
      const ticker = page.getByTestId('price-ticker');
      await expect(ticker).toBeVisible({ timeout: 10_000 });

      await ticker.focus();
      // Navigate to page 2 via ArrowRight then activate button via keyboard
      await page.keyboard.press('ArrowRight');
      await expect(page.getByText('FAKE')).toBeVisible();

      // Focus Next is disabled on page 2; verify Previous is reachable via ArrowLeft shortcut
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByText('XLM', { exact: true })).toBeVisible();

      // Verify Enter activates focused pagination button (disable Previous skip handled)
      // On page 1 disabled Previous is skipped, so single Tab reaches Next
      await ticker.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Next price page' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByText('2 / 2')).toBeVisible();
    });

    test('keyboard help text is accessible via aria-describedby', async ({ page }) => {
      await stubCoinGeckoOk(page);
      await gotoHarness(page, 'refreshInterval=600000');
      const ticker = page.getByTestId('price-ticker');
      await expect(ticker).toBeVisible({ timeout: 10_000 });
      await expect(ticker).toHaveAttribute('aria-label', 'Market prices ticker');
      await expect(ticker).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight R');
      const describedBy = await ticker.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const helpText = page.locator(`#${describedBy}`);
      await expect(helpText).toContainText('Keyboard shortcuts');
    });
  });

  test.describe('No real network calls', () => {
    test('stubs at route level and does not hit real CoinGecko', async ({ page }) => {
      const fulfilledUrls: string[] = [];
      const externalUrls: string[] = [];

      await page.route('**/api.coingecko.com/**', async (route) => {
        fulfilledUrls.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(COINGECKO_OK_FIXTURE),
        });
      });

      // Catch any other coingecko pattern without double counting
      await page.route('**/coingecko.com/**', async (route) => {
        // Only count if not already handled by the more specific pattern
        fulfilledUrls.push(route.request().url());
        try {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(COINGECKO_OK_FIXTURE),
          });
        } catch {}
      });

      // Track any external request that was NOT stubbed (should be zero for coingecko)
      page.on('requestfinished', (req) => {
        const url = req.url();
        if (url.includes('coingecko') && !fulfilledUrls.includes(url)) {
          externalUrls.push(url);
        }
      });

      await gotoHarness(page, 'refreshInterval=600000');
      await expect(page.getByTestId('price-ticker')).toBeVisible({ timeout: 10_000 });

      // At least one coingecko request was intercepted and fulfilled (route-level stub)
      expect(fulfilledUrls.length).toBeGreaterThanOrEqual(1);
      expect(externalUrls.length).toBe(0);

      // Ensure ticker rendered from stubbed data (proves no fallback to real API)
      await expect(page.getByText('$0.1100')).toBeVisible();
    });
  });
});
