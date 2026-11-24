import { expect } from '@playwright/test';
import { test } from './fixtures';

test('production policy permits the app’s external connections', async ({
  page,
}) => {
  const endpoints = [
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
      'https://soroban-testnet.stellar.org',
    'https://api.coingecko.com/api/v3/simple/price',
    'https://www.cloudflare.com/cdn-cgi/trace',
  ];

  for (const endpoint of endpoints) {
    await page.route(endpoint, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        body: 'ok',
      }),
    );
  }

  const response = await page.goto('/');
  expect(await response?.headerValue('content-security-policy')).toContain(
    'connect-src',
  );
  for (const endpoint of endpoints) {
    await expect(
      page.evaluate(async (url) => (await fetch(url)).text(), endpoint),
    ).resolves.toBe('ok');
  }
});
