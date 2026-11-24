import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import BankDetailsModal from '../BankDetailsModal';
import * as cryptoPriceService from '@/lib/cryptoPriceService';

const mockAddNotification = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ addNotification: mockAddNotification }),
}));
vi.mock('@/hooks/useBeneficiaries', () => ({
  useBeneficiaries: () => ({
    beneficiaries: [],
    isLoaded: true,
    addBeneficiary: vi.fn(),
    renameBeneficiary: vi.fn(),
    deleteBeneficiary: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({ addEntry: vi.fn() }),
}));
vi.mock('@/lib/cryptoPriceService', () => ({
  fetchLockedQuote: vi.fn().mockResolvedValue({
    ngnAmount: 1000,
    xlmAmount: 10,
    rate: 100,
    expiresAt: Date.now() + 120000,
  }),
}));
vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => ({}),
}));
vi.mock('@/hooks/useIdempotentAction', () => ({
  useIdempotentAction: () => ({
    execute: async (fn: (key: string) => Promise<void>) => {
      await fn('test-key');
    },
    isProcessing: false,
  }),
}));
vi.mock('@/lib/chatTelemetry', () => ({
  chatTelemetry: { fiatPayoutStep: vi.fn() },
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  xlmAmount: 10,
};

// The status-polling effect checks every 5s (see BankDetailsModal.tsx); give
// waitFor enough real-clock budget to observe at least one tick.
const POLL_WAIT_TIMEOUT = 7000;

function makeFetch(transferStatusResponse: {
  status: 'success' | 'failed' | 'reversed';
  failureReason?: string;
}) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/api/banks')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [{ id: 1, name: 'Test Bank', code: '001', active: true }],
        }),
      };
    }
    if (url.includes('/api/verify-account')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { account_name: 'Test Account' },
        }),
      };
    }
    if (url.includes('/api/create-recipient')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { recipient_code: 'RCP_test123' },
        }),
      };
    }
    if (url.includes('/api/initiate-transfer')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            reference: 'TRF_test123',
            transfer_code: 'TRF_test123',
            status: 'pending',
          },
        }),
      };
    }
    if (url.includes('/api/transfer-status/')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { reference: 'TRF_test123', ...transferStatusResponse },
        }),
      };
    }
    throw new Error(`Unhandled: ${url}`);
  });
}

async function navigateToConfirmAndSubmit() {
  await screen.findByText('Test Bank');

  fireEvent.click(screen.getByText('Test Bank'));
  const nextBtn1 = await screen.findByRole('button', { name: /next/i });
  fireEvent.click(nextBtn1);

  await screen.findByText(/Enter your account number/i);
  const accountInput = await screen.findByPlaceholderText(/0000000000/i);
  fireEvent.change(accountInput, { target: { value: '1234567890' } });
  fireEvent.blur(accountInput);
  await screen.findByText(/Test Account/i);

  const nextBtn2 = await screen.findByRole('button', { name: /next/i });
  fireEvent.click(nextBtn2);

  const confirmButton = await screen.findByRole('button', {
    name: /confirm payout/i,
  });
  fireEvent.click(confirmButton);

  // The transfer has been initiated but not yet resolved — this is the
  // regression check for #1478: the UI must show the pending state, not an
  // immediate, unconditional success.
  await screen.findByText(/Processing Payout/i);
  expect(screen.queryByText(/Payout Successful/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Payout Failed/i)).not.toBeInTheDocument();
  expect(mockAddNotification).not.toHaveBeenCalledWith(
    'payout_success',
    expect.anything(),
  );
}

describe('BankDetailsModal - transfer status resolution (#1478)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it(
    'moves pending → success only once the status poll confirms it',
    async () => {
      vi.spyOn(global, 'fetch').mockImplementation(
        makeFetch({ status: 'success' }) as any,
      );
      vi.spyOn(cryptoPriceService, 'fetchLockedQuote').mockResolvedValue({
        ngnAmount: 1000,
        xlmAmount: 10,
        rate: 100,
        expiresAt: Date.now() + 120000,
      } as any);

      render(<BankDetailsModal {...defaultProps} />);
      await navigateToConfirmAndSubmit();

      await waitFor(
        () => {
          expect(screen.getByText(/Payout Successful/i)).toBeInTheDocument();
        },
        { timeout: POLL_WAIT_TIMEOUT },
      );
      expect(mockAddNotification).toHaveBeenCalledWith(
        'payout_success',
        expect.stringContaining('successfully completed'),
      );
    },
    POLL_WAIT_TIMEOUT + 5000,
  );

  it(
    'moves pending → failed and surfaces the failure reason once the status poll confirms it',
    async () => {
      vi.spyOn(global, 'fetch').mockImplementation(
        makeFetch({
          status: 'failed',
          failureReason: 'Insufficient funds',
        }) as any,
      );
      vi.spyOn(cryptoPriceService, 'fetchLockedQuote').mockResolvedValue({
        ngnAmount: 1000,
        xlmAmount: 10,
        rate: 100,
        expiresAt: Date.now() + 120000,
      } as any);

      render(<BankDetailsModal {...defaultProps} />);
      await navigateToConfirmAndSubmit();

      await waitFor(
        () => {
          expect(screen.getByText(/Payout Failed/i)).toBeInTheDocument();
        },
        { timeout: POLL_WAIT_TIMEOUT },
      );
      // Appears both in the status paragraph and the transfer timeline.
      expect(screen.getAllByText(/Insufficient funds/i).length).toBeGreaterThan(
        0,
      );
      expect(mockAddNotification).toHaveBeenCalledWith(
        'payout_fail',
        expect.stringContaining('Insufficient funds'),
      );
      expect(mockAddNotification).not.toHaveBeenCalledWith(
        'payout_success',
        expect.anything(),
      );
    },
    POLL_WAIT_TIMEOUT + 5000,
  );
});
