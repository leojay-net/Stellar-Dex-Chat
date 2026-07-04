import { expect, type Page } from '@playwright/test';
import { xdr } from '@stellar/stellar-sdk';

/** Valid Stellar testnet address used for admin E2E flows. */
export const MOCK_ADMIN_ADDRESS =
  'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW';

/** ScVal XDR (base64) for {@link MOCK_ADMIN_ADDRESS} — used in Soroban simulate mocks. */
const MOCK_ADMIN_SCVAL_XDR =
  'AAAAEgAAAAAAAAAASFXb0ZgW04l/PbSG2DwEj5+TzC+JpDkIYGpAU0HQeXU=';

/** i128 ScVal XDR mocks for read-only bridge contract view calls (stroops). */
const MOCK_BRIDGE_LIMIT_XDR = 'AAAACgAAAAAAAAAAAAAAF0h26AA='; // 10_000 XLM
const MOCK_CONTRACT_BALANCE_XDR = 'AAAACgAAAAAAAAAAAAAAC6Q7dAA='; // 5_000 XLM
const MOCK_TOTAL_DEPOSITED_XDR = 'AAAACgAAAAAAAAAAAAAABdIdugA='; // 2_500 XLM

function getSimulateFunctionName(transactionXdr: string): string | null {
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, 'base64');
    const op = envelope.v1().tx().operations()[0];
    const body = op.body();
    if (body.switch().name !== 'invokeHostFunction') {
      return null;
    }
    return body
      .invokeHostFunctionOp()
      .hostFunction()
      .invokeContract()
      .functionName()
      .toString();
  } catch {
    return null;
  }
}

function scvalXdrForSimulateFunction(functionName: string | null): string {
  switch (functionName) {
    case 'get_admin':
      return MOCK_ADMIN_SCVAL_XDR;
    case 'get_limit':
      return MOCK_BRIDGE_LIMIT_XDR;
    case 'get_balance':
      return MOCK_CONTRACT_BALANCE_XDR;
    case 'get_total_deposited':
      return MOCK_TOTAL_DEPOSITED_XDR;
    default:
      return MOCK_BRIDGE_LIMIT_XDR;
  }
}

export const MOCK_WALLET_ADDRESS = MOCK_ADMIN_ADDRESS;

/** Locator for the admin reconciliation page title (WebKit-tolerant). */
export function adminReconciliationHeading(page: Page) {
  return page
    .getByRole('heading', { name: /Admin Reconciliation Dashboard/i })
    .or(page.getByText(/Admin Reconciliation Dashboard/i));
}

/**
 * Inject a mockStellarConnect stub before navigation so early boot code does not
 * race the React provider (important on slower WebKit CI runs).
 */
export async function installMockWalletBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof window.mockStellarConnect !== 'function') {
      window.mockStellarConnect = (addr: string) => {
        (window as Window & { __MOCK_CONNECTED_ADDRESS__?: string }).__MOCK_CONNECTED_ADDRESS__ =
          addr;
        window.dispatchEvent(
          new CustomEvent('mockStellarConnect', { detail: addr }),
        );
      };
    }
  });
}

/** Connect a mock wallet via the app's E2E hook (must run after navigation). */
export async function connectMockWallet(
  page: Page,
  address: string = MOCK_WALLET_ADDRESS,
): Promise<void> {
  await installMockWalletBridge(page);
  // Retry until StellarWalletProvider replaces the init-script stub and persists the address.
  await page.waitForFunction(
    (addr) => {
      if (typeof window.mockStellarConnect !== 'function') {
        return false;
      }
      if (localStorage.getItem('stellar_address') === addr) {
        return true;
      }
      window.mockStellarConnect?.(addr);
      return localStorage.getItem('stellar_address') === addr;
    },
    address,
    { timeout: 20_000 },
  );
}

/** Navigate to /chat and connect a mock wallet. */
export async function gotoChatConnected(
  page: Page,
  address: string = MOCK_WALLET_ADDRESS,
): Promise<void> {
  await installMockWalletBridge(page);
  await page.goto('/chat');
  await page.waitForLoadState('domcontentloaded');
  await connectMockWallet(page, address);
  await expect(page.getByRole('button', { name: /deposit xlm/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** Mock Soroban RPC so contract view/write calls do not hit the network. */
export async function mockSorobanRpc(
  page: Page,
  options: { adminAddress?: string } = {},
): Promise<void> {
  const adminAddress = options.adminAddress ?? MOCK_WALLET_ADDRESS;

  await page.route('**/horizon-testnet.stellar.org/accounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: adminAddress,
        account_id: adminAddress,
        sequence: '123456789',
        balances: [{ balance: '1000.0000000', asset_type: 'native' }],
      }),
    });
  });

  await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    let body: { method?: string; id?: number | string } | null = null;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = null;
    }

    const method = body?.method ?? '';
    const id = body?.id ?? 1;

    if (method === 'getLatestLedger') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { sequence: 12_345, protocolVersion: 22 },
        }),
      });
      return;
    }

    if (method === 'getNetwork') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { passphrase: 'Test SDF Network ; September 2015' },
        }),
      });
      return;
    }

    if (method === 'getAccount' || method === 'getAccounts') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            id: adminAddress,
            sequence: '123456789',
            balances: [],
          },
        }),
      });
      return;
    }

    if (method === 'simulateTransaction') {
      const rawParams = (body as { params?: unknown } | null)?.params;
      const params =
        rawParams && !Array.isArray(rawParams)
          ? (rawParams as { transaction?: string })
          : Array.isArray(rawParams)
            ? (rawParams[0] as { transaction?: string } | undefined)
            : undefined;
      const functionName = params?.transaction
        ? getSimulateFunctionName(params.transaction)
        : null;
      const resultXdr = scvalXdrForSimulateFunction(functionName);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            transactionData: '',
            results: [{ xdr: resultXdr }],
            cost: { cpuInsns: '0', memBytes: '0' },
            latestLedger: 12_345,
            minResourceFee: '0',
          },
        }),
      });
      return;
    }

    if (method === 'sendTransaction') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            status: 'SUCCESS',
            results: [{ xdr: 'AAAAAAAAAGQAAAAAAAAAAQ==' }],
            cost: { cpuInsns: '0', memBytes: '0' },
            latestLedger: 12_345,
            latestLedgerCloseTime: '1711670400',
          },
        }),
      });
      return;
    }

    await route.continue();
  });
}

/** Mock reconciliation API with deterministic fixture data. */
export async function mockReconciliationApi(page: Page): Promise<void> {
  await page.route('**/api/admin/reconciliation*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '1',
          depositTxHash: '0x123abc',
          depositAmount: '100.0',
          depositUser: 'GA123...',
          depositDate: '2026-03-20T10:00:00Z',
          payoutId: 'TRF_123456',
          payoutAmount: '100.0',
          payoutRecipient: 'John Doe - 1234567890',
          payoutStatus: 'completed',
          payoutDate: '2026-03-20T11:00:00Z',
          status: 'matched',
        },
        {
          id: '2',
          depositTxHash: '0x456def',
          depositAmount: '50.0',
          depositUser: 'GA456...',
          depositDate: '2026-03-21T14:30:00Z',
          payoutId: 'TRF_789012',
          payoutAmount: '50.0',
          payoutRecipient: 'Jane Smith - 0987654321',
          payoutStatus: 'pending',
          payoutDate: '2026-03-21T15:00:00Z',
          status: 'matched',
        },
        {
          id: '3',
          depositTxHash: '0x789ghi',
          depositAmount: '25.0',
          depositUser: 'GA789...',
          depositDate: '2026-03-22T09:15:00Z',
          payoutId: '',
          payoutAmount: '',
          payoutRecipient: '',
          payoutStatus: 'pending',
          payoutDate: '',
          status: 'unmatched',
        },
        {
          id: '4',
          depositTxHash: '0xabcpqr',
          depositAmount: '75.0',
          depositUser: 'GAABC...',
          depositDate: '2026-03-23T16:45:00Z',
          payoutId: 'TRF_345678',
          payoutAmount: '70.0',
          payoutRecipient: 'Bob Wilson - 1122334455',
          payoutStatus: 'failed',
          payoutDate: '2026-03-23T17:00:00Z',
          status: 'error',
        },
      ]),
    });
  });
}

/** Open /admin/reconciliation as a mocked contract admin with fixture data. */
export async function gotoAdminReconciliation(page: Page): Promise<void> {
  await mockSorobanRpc(page, { adminAddress: MOCK_ADMIN_ADDRESS });
  await mockReconciliationApi(page);
  await installMockWalletBridge(page);
  await page.goto('/admin/reconciliation');
  await page.waitForLoadState('domcontentloaded');
  await connectMockWallet(page, MOCK_ADMIN_ADDRESS);
  await expect(page.getByText(/Verifying admin access/i)).toBeHidden({
    timeout: 30_000,
  });
  await expect(adminReconciliationHeading(page)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Loading...')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('combobox').first()).toBeVisible({
    timeout: 20_000,
  });
}

/** Open the deposit modal from the chat network badge. */
export async function openDepositModalFromChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: /deposit xlm/i }).click();
  await page.getByRole('dialog', { name: /deposit to bridge/i }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
}

/** Open the withdraw modal from the chat network badge (requires admin RPC mock). */
export async function openWithdrawModalFromChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: /withdraw xlm/i }).click();
  await page.getByRole('dialog', { name: /withdraw from bridge/i }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
}
