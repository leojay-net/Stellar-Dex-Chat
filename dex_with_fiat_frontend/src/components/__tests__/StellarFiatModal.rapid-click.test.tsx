import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import StellarFiatModal from '../StellarFiatModal';

const depositToContract = vi.fn().mockResolvedValue('HASHDEPOSIT123');
const withdrawFromContract = vi.fn().mockResolvedValue('HASHWITHDRAW123');

vi.mock('@/lib/stellarContract', () => ({
  pollTransaction: vi.fn().mockResolvedValue('HASHPOLL'),
  BRIDGE_LIMIT_WARNING_PERCENT: 80,
  CONTRACT_ID: 'CTEST_CONTRACT_ID',
  depositToContract: (...args: unknown[]) => depositToContract(...args),
  withdrawFromContract: (...args: unknown[]) => withdrawFromContract(...args),
  clearCache: vi.fn(),
  simulateDeposit: vi.fn().mockResolvedValue(null),
  simulateWithdraw: vi.fn().mockResolvedValue(null),
}));

const TEST_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: {
      isConnected: true,
      publicKey: TEST_KEY,
      address: TEST_KEY,
      network: 'TESTNET',
    },
    signTx: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBridgeStats', () => ({
  default: () => ({
    limit: 100_000_000_000n, // 10,000 XLM in stroops — well above the test amount
    loading: false,
    error: null,
    refetchStats: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/cryptoPriceService', () => ({
  getTokenPrice: vi.fn().mockResolvedValue(0.12),
  formatFiatAmount: vi.fn().mockReturnValue('$1.20'),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ addNotification: vi.fn() }),
}));

vi.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({
    addEntry: vi.fn(),
    entries: [],
    clearEntries: vi.fn(),
    updateEntry: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => undefined,
}));

vi.mock('@/lib/receipt', () => ({
  downloadReceipt: vi.fn(),
}));

// Pass-through: strip the hook's own idempotency guard so the test exercises
// the component's rapid-click protection directly.
vi.mock('@/hooks/useIdempotentAction', () => ({
  useIdempotentAction: () => ({
    execute: async (fn: (key: string) => Promise<void>) => {
      await fn('test-key');
    },
    isProcessing: false,
  }),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  defaultAmount: '10',
};

async function getSubmitButton() {
  return waitFor(
    () => screen.getByRole('button', { name: /review transaction/i }),
    { timeout: 2000 },
  );
}

describe('StellarFiatModal - rapid click protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false }) as unknown as typeof fetch;
  });

  afterEach(cleanup);

  it('submits only once when the deposit button is clicked rapidly', async () => {
    render(<StellarFiatModal {...defaultProps} />);
    const submit = await getSubmitButton();

    // Batch the clicks in a single act() so React does not flush the
    // disabling re-render between them — this reproduces a true double-click.
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(depositToContract).toHaveBeenCalledTimes(1);
    });
  });

  it('still allows a single legitimate deposit to go through', async () => {
    render(<StellarFiatModal {...defaultProps} />);
    const submit = await getSubmitButton();

    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(depositToContract).toHaveBeenCalledTimes(1);
    });
  });
});
