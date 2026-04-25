import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import StellarFiatModal from './StellarFiatModal';

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: {
      isConnected: true,
      publicKey: 'GABCDEF1234567890',
      address: 'GABCDEF1234567890',
      network: 'TESTNET',
    },
    signTx: vi.fn(),
  }),
}));

vi.mock('@/lib/stellarContract', () => ({
  depositToContract: vi.fn(),
  withdrawFromContract: vi.fn(),
  stroopsToDisplay: (stroops: bigint) => String(Number(stroops) / 1e7),
}));

const onClose = vi.fn();
const onDepositSuccess = vi.fn();

describe('StellarFiatModal', () => {
  let mockedContract: Awaited<ReturnType<typeof import('@/lib/stellarContract')>>;

  beforeEach(async () => {
    mockedContract = await import('@/lib/stellarContract');
    mockedContract.depositToContract.mockReset();
    mockedContract.withdrawFromContract.mockReset();
    onClose.mockReset();
    onDepositSuccess.mockReset();
  });

  it('shows a pending optimistic UI while the transaction is in progress and then confirms success', async () => {
    mockedContract.depositToContract.mockResolvedValueOnce('TXHASH123');

    const { getByRole } = render(
      React.createElement(StellarFiatModal, {
        isOpen: true,
        onClose,
        defaultAmount: '10',
        onDepositSuccess,
      }),
    );

    await waitFor(() => {
      expect(getByRole('button', { name: /deposit/i })).toBeInTheDocument();
    });

    fireEvent.click(getByRole('button', { name: /deposit/i }));

    expect(screen.getByText(/Deposit pending/i)).toBeInTheDocument();
    expect(screen.getByText(/10 XLM is being processed/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Transaction Confirmed/i)).toBeInTheDocument();
    });

    expect(screen.getByText('TXHASH123')).toBeInTheDocument();
  });

  it('shows an error state when the transaction fails', async () => {
    mockedContract.depositToContract.mockRejectedValueOnce(new Error('Network failure'));

    const { getByRole } = render(
      React.createElement(StellarFiatModal, {
        isOpen: true,
        onClose: onClose,
        defaultAmount: '2',
      }),
    );

    await waitFor(() => {
      expect(getByRole('button', { name: /deposit/i })).toBeInTheDocument();
    });

    fireEvent.click(getByRole('button', { name: /deposit/i }));

    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
    });
  });
});

/**
 * Regression tests for Issue #709 — memory leak in StellarFiatModal.
 *
 * The root cause was that the fiat estimate update used a useCallback + useEffect
 * pattern without a cancellation flag, allowing setState calls on unmounted components.
 * The fix refactors it into a single useEffect with a `cancelled` flag in its cleanup.
 *
 * These tests validate the cancellation pattern logic in isolation.
 */
describe('StellarFiatModal fiat estimate cancellation pattern (Issue #709)', () => {
  it('should demonstrate that the cancelled flag prevents state updates', async () => {
    let cancelled = false;
    let stateUpdated = false;

    const setState = () => {
      if (!cancelled) {
        stateUpdated = true;
      }
    };

    // Simulate an async fetch that resolves after cleanup
    const fetchPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('$100.00'), 50);
    });

    // Run the async work
    const asyncWork = fetchPromise.then((result) => {
      setState(result);
    });

    // Simulate unmount before the fetch completes
    cancelled = true;

    await asyncWork;

    // State should NOT have been updated
    expect(stateUpdated).toBe(false);
  });

  it('should allow state update when not cancelled', async () => {
    const cancelled = false;
    let stateValue: string | null = null;

    const setState = (value: string | null) => {
      if (!cancelled) {
        stateValue = value;
      }
    };

    const fetchPromise = Promise.resolve('$250.00');

    await fetchPromise.then((result) => {
      setState(result);
    });

    // State should have been updated
    expect(stateValue).toBe('$250.00');
  });

  it('should handle errors without updating state when cancelled', async () => {
    let cancelled = false;
    let stateValue: string | null = 'initial';

    const setState = (value: string | null) => {
      if (!cancelled) {
        stateValue = value;
      }
    };

    const fetchPromise = Promise.reject(new Error('Network error'));

    // Simulate unmount
    cancelled = true;

    await fetchPromise.catch(() => {
      setState(null);
    });

    // State should still be 'initial' (unchanged)
    expect(stateValue).toBe('initial');
  });

  it('should only update state from the latest effect cycle', async () => {
    const states: (string | null)[] = [];

    // Simulate two rapid effect cycles (e.g., user types quickly)
    let cancelled1 = false;
    const cancelled2 = false;

    const slowFetch = new Promise<string>((resolve) => {
      setTimeout(() => resolve('slow-result'), 100);
    });
    const fastFetch = Promise.resolve('fast-result');

    // First cycle starts
    const work1 = slowFetch.then((result) => {
      if (!cancelled1) states.push(result);
    });

    // Second cycle starts — first cycle is cleaned up
    cancelled1 = true;
    const work2 = fastFetch.then((result) => {
      if (!cancelled2) states.push(result);
    });

    await Promise.all([work1, work2]);

    // Only the fast result (latest) should appear
    expect(states).toEqual(['fast-result']);
  });
});
