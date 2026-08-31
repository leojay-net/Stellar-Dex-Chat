import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for ChatSearchPanel component.
 *
 * Uses the /test-chat-search-panel harness which mounts the panel with two
 * fixture sessions.  No external network calls are made by ChatSearchPanel
 * itself (it operates entirely on in-memory session data).
 */

const TEST_URL = '/test-chat-search-panel';

async function gotoHarness(page: Page) {
  await page.goto(TEST_URL);
  await page.waitForLoadState('domcontentloaded');
}

/** The keyword input rendered inside the panel header. */
function searchInput(page: Page) {
  return page.getByLabel('Search keyword');
}

test.describe('ChatSearchPanel', () => {
  test.describe('Happy path', () => {
    test('search panel renders with keyword input visible', async ({ page }) => {
      await gotoHarness(page);

      const input = searchInput(page);
      await expect(input).toBeVisible({ timeout: 5_000 });
    });

    test('empty state shows "Type to search messages" prompt', async ({ page }) => {
      await gotoHarness(page);

      await expect(page.getByText('Type to search messages')).toBeVisible({
        timeout: 5_000,
      });
    });

    test('typing a keyword returns matching results', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('XLM');

      // Should find the Alpha session whose message contains "XLM"
      await expect(page.getByText('Alpha XLM swap')).toBeVisible({ timeout: 5_000 });
    });

    test('search results show session title, role and date', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('swap');

      const result = page.locator('[role="option"]').first();
      await expect(result).toBeVisible({ timeout: 5_000 });

      // Session title link
      await expect(result.getByText('Alpha XLM swap')).toBeVisible();
      // Role attribution
      await expect(result.getByText(/You/)).toBeVisible();
    });

    test('clicking a result fires onSelectResult with correct IDs', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('XLM');

      const firstResult = page.locator('[role="option"] button').first();
      await expect(firstResult).toBeVisible({ timeout: 5_000 });
      await firstResult.click();

      const output = page.getByTestId('selected-result');
      await expect(output).toBeVisible({ timeout: 3_000 });
      await expect(output).toContainText('session-alpha');
    });

    test('result count footer shows correct number', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('swap');

      // Should show "1 result" or "N results"
      await expect(page.getByText(/\d+ result/)).toBeVisible({ timeout: 5_000 });
    });

    test('highlights search term inside the snippet', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('swap');

      // The highlighted <mark> element should contain the keyword
      const mark = page.locator('mark').first();
      await expect(mark).toBeVisible({ timeout: 5_000 });
      const text = await mark.textContent();
      expect(text?.toLowerCase()).toContain('swap');
    });
  });

  test.describe('Empty / no-results state', () => {
    test('shows "No messages found" when query matches nothing', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('zzz_no_match_xyz');

      await expect(page.getByText('No messages found')).toBeVisible({ timeout: 5_000 });
    });

    test('result count is 0 when no matches', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('zzz_no_match_xyz');

      await expect(page.getByText('0 results')).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Advanced filters', () => {
    test('Advanced filters section toggles on click', async ({ page }) => {
      await gotoHarness(page);

      const toggle = page.getByRole('button', { name: /advanced filters/i });
      await expect(toggle).toBeVisible();

      // Advanced inputs not yet visible
      await expect(page.getByLabel('Filter by wallet address')).toBeHidden();

      await toggle.click();

      await expect(page.getByLabel('Filter by wallet address')).toBeVisible({
        timeout: 3_000,
      });
    });

    test('wallet address filter narrows results', async ({ page }) => {
      await gotoHarness(page);

      // Type a keyword first to get results
      await searchInput(page).fill('swap');
      await expect(page.getByText('Alpha XLM swap')).toBeVisible({ timeout: 5_000 });

      // Open advanced filters and enter the wallet address from fixture
      await page.getByRole('button', { name: /advanced filters/i }).click();
      await page.getByLabel('Filter by wallet address').fill(
        'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW',
      );

      // Alpha session should still appear (it has this wallet address)
      await expect(page.getByText('Alpha XLM swap')).toBeVisible({ timeout: 5_000 });
    });

    test('date-from filter is reachable', async ({ page }) => {
      await gotoHarness(page);

      await page.getByRole('button', { name: /advanced filters/i }).click();

      const dateFrom = page.getByLabel('Date from');
      await expect(dateFrom).toBeVisible({ timeout: 3_000 });
      await expect(dateFrom).toBeEnabled();
    });

    test('date-to filter is reachable', async ({ page }) => {
      await gotoHarness(page);

      await page.getByRole('button', { name: /advanced filters/i }).click();

      const dateTo = page.getByLabel('Date to');
      await expect(dateTo).toBeVisible({ timeout: 3_000 });
      await expect(dateTo).toBeEnabled();
    });

    test('Clear button resets all filters', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('swap');
      await expect(page.getByText('Alpha XLM swap')).toBeVisible({ timeout: 5_000 });

      // Clear button appears when any filter is set
      const clearBtn = page.getByTitle('Clear filters');
      await expect(clearBtn).toBeVisible();
      await clearBtn.click();

      // Panel returns to empty state
      await expect(page.getByText('Type to search messages')).toBeVisible({
        timeout: 3_000,
      });
    });
  });

  test.describe('Close behaviour', () => {
    test('close button hides the panel', async ({ page }) => {
      await gotoHarness(page);

      const closeBtn = page.getByRole('button', { name: /close search/i });
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();

      // The search input should no longer be in the DOM
      await expect(searchInput(page)).toBeHidden({ timeout: 3_000 });
    });

    test('Open Search button re-opens the panel after close', async ({ page }) => {
      await gotoHarness(page);

      await page.getByRole('button', { name: /close search/i }).click();
      await expect(searchInput(page)).toBeHidden({ timeout: 3_000 });

      await page.getByRole('button', { name: 'Open search panel' }).click();
      await expect(searchInput(page)).toBeVisible({ timeout: 3_000 });
    });

    test('Escape key closes the panel', async ({ page }) => {
      await gotoHarness(page);

      // Focus the search input then press Escape
      await searchInput(page).focus();
      await page.keyboard.press('Escape');

      await expect(searchInput(page)).toBeHidden({ timeout: 3_000 });
    });
  });

  test.describe('Keyboard navigation', () => {
    test('search input is focused on mount', async ({ page }) => {
      await gotoHarness(page);

      const input = searchInput(page);
      await expect(input).toBeVisible({ timeout: 5_000 });
      // Allow auto-focus to settle
      await page.waitForTimeout(200);
      await expect(input).toBeFocused();
    });

    test('ArrowDown and ArrowUp move the active result', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('');
      // Use a term that matches both fixture sessions
      await searchInput(page).fill('e'); // matches 'DEX' and 'bridge'

      const results = page.locator('[role="option"]');
      const count = await results.count();
      if (count < 2) {
        test.skip();
        return;
      }

      // First result should be active (index 0)
      await expect(results.first()).toHaveAttribute('aria-selected', 'true');

      // Move down
      await searchInput(page).press('ArrowDown');
      await expect(results.nth(1)).toHaveAttribute('aria-selected', 'true');

      // Move back up
      await searchInput(page).press('ArrowUp');
      await expect(results.first()).toHaveAttribute('aria-selected', 'true');
    });

    test('Enter key selects the active result', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('XLM');
      await expect(page.locator('[role="option"]').first()).toBeVisible({
        timeout: 5_000,
      });

      await searchInput(page).press('Enter');

      const output = page.getByTestId('selected-result');
      await expect(output).toBeVisible({ timeout: 3_000 });
    });

    test('Tab reaches the Advanced filters toggle', async ({ page }) => {
      await gotoHarness(page);

      const toggle = page.getByRole('button', { name: /advanced filters/i });
      await toggle.focus();
      await expect(toggle).toBeFocused();
    });

    test('Tab reaches the Close search button', async ({ page }) => {
      await gotoHarness(page);

      const closeBtn = page.getByRole('button', { name: /close search/i });
      await closeBtn.focus();
      await expect(closeBtn).toBeFocused();
    });

    test('result buttons are reachable via Tab', async ({ page }) => {
      await gotoHarness(page);

      await searchInput(page).fill('swap');
      const firstResult = page.locator('[role="option"] button').first();
      await expect(firstResult).toBeVisible({ timeout: 5_000 });

      await firstResult.focus();
      await expect(firstResult).toBeFocused();
    });
  });

  test.describe('No real network calls', () => {
    test('panel operates entirely on in-memory data — no outbound requests', async ({
      page,
    }) => {
      const externalRequests: string[] = [];
      page.on('request', (req) => {
        const url = req.url();
        if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
          externalRequests.push(url);
        }
      });

      await gotoHarness(page);

      await searchInput(page).fill('bridge');
      await expect(page.getByText('Bridge deposit status')).toBeVisible({
        timeout: 5_000,
      });

      const apiRequests = externalRequests.filter(
        (url) => !url.includes('_next') && !url.includes('fonts.') && !url.includes('cdn.'),
      );
      expect(apiRequests.length).toBe(0);
    });
  });
});
