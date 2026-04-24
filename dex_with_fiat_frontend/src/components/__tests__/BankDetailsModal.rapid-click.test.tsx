import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BankDetailsModal from '../BankDetailsModal';

// Mock dependencies
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    addNotification: vi.fn(),
  }),
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
  useTxHistory: () => ({
    addEntry: vi.fn(),
  }),
}));

vi.mock('@/lib/cryptoPriceService', () => ({
  fetchLockedQuote: vi.fn().mockResolvedValue({
    ngnAmount: 1000,
    xlmAmount: 10,
    rate: 100,
    expiresAt: Date.now() + 120000,
  }),
  formatFiatAmount: (val: number, cur: string) => `${cur} ${val}`,
}));

vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => ({
    modalRef: { current: null },
  }),
}));

vi.mock('@/lib/chatTelemetry', () => ({
  chatTelemetry: {
    fiatPayoutStep: vi.fn(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

describe('BankDetailsModal - Rapid Click Protection', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    xlmAmount: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock successful API responses
    vi.mocked(global.fetch).mockImplementation((input: string | Request | URL) => {
      const url = input.toString();
      if (url.includes('/api/banks')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: [
                {
                  id: 1,
                  name: 'Test Bank',
                  code: '001',
                  active: true,
                  country: 'Nigeria',
                  currency: 'NGN',
                  type: 'nuban',
                },
              ],
            }),
        });
      }
      if (url.includes('/api/verify-account')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: { account_name: 'Test Account' },
            }),
        });
      }
      if (url.includes('/api/create-recipient')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: { recipient_code: 'RCP_test123' },
            }),
        });
      }
      if (url.includes('/api/initiate-transfer')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                reference: 'TRF_test123',
                transfer_code: 'TRF_test123',
                status: 'pending',
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unknown endpoint: ${url}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const navigateToConfirmation = async () => {
    // Stage 1
    await screen.findByText('Test Bank');
    const bankItem = screen.getByText('Test Bank');
    
    // Select bank
    await act(async () => {
      fireEvent.click(bankItem);
    });

    const nextButton = await screen.findByRole('button', { name: /next/i });
    
    // Wait until it is enabled
    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    }, { timeout: 3000 });

    await act(async () => {
      fireEvent.click(nextButton);
    });

    // Stage 2
    const accountInput = await screen.findByPlaceholderText(/account number/i);
    await act(async () => {
      fireEvent.change(accountInput, { target: { value: '1234567890' } });
    });

    const verifyButton = await screen.findByRole('button', { name: /verify/i });
    await act(async () => {
      fireEvent.click(verifyButton);
    });

    await screen.findByText(/Test Account/i);

    const continueButton = await screen.findByRole('button', { name: /continue/i });
    await act(async () => {
      fireEvent.click(continueButton);
    });

    // Stage 3
    await screen.findByRole('button', { name: /confirm payout/i });
  };

  it('should prevent duplicate payout confirmations on rapid clicks', async () => {
    render(<BankDetailsModal {...defaultProps} />);
    await navigateToConfirmation();

    const confirmButton = screen.getByRole('button', { name: /confirm payout/i });

    // Rapidly click confirm button
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const createRecipientCalls = vi.mocked(global.fetch).mock.calls.filter((call) =>
        (call[0] as unknown as string).includes('/api/create-recipient'),
      );
      expect(createRecipientCalls).toHaveLength(1);
    }, { timeout: 3000 });
  });

  it('should include idempotency key in API requests', async () => {
    render(<BankDetailsModal {...defaultProps} />);
    await navigateToConfirmation();

    const confirmButton = screen.getByRole('button', { name: /confirm payout/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const createRecipientCall = vi.mocked(global.fetch).mock.calls.find((call) =>
        (call[0] as unknown as string).includes('/api/create-recipient'),
      );

      expect(createRecipientCall).toBeDefined();
      expect((createRecipientCall?.[1] as RequestInit).headers).toBeDefined();
      const headers = (createRecipientCall?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-Idempotency-Key']).toMatch(
        /^payout_confirm_\d+_[a-z0-9]+$/,
      );
    });
  });
});
