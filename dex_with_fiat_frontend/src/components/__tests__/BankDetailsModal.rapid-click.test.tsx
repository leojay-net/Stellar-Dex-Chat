import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BankDetailsModal from '../BankDetailsModal';

// Mock dependencies
jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    addNotification: jest.fn(),
  }),
}));

jest.mock('@/hooks/useBeneficiaries', () => ({
  useBeneficiaries: () => ({
    beneficiaries: [],
    isLoaded: true,
    addBeneficiary: jest.fn(),
    renameBeneficiary: jest.fn(),
    deleteBeneficiary: jest.fn(),
  }),
}));

jest.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({
    addEntry: jest.fn(),
  }),
}));

jest.mock('@/lib/cryptoPriceService', () => ({
  fetchLockedQuote: jest.fn().mockResolvedValue({
    ngnAmount: 1000,
    xlmAmount: 10,
    rate: 100,
    expiresAt: Date.now() + 120000,
  }),
}));

jest.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => ({
    modalRef: { current: null },
  }),
}));

// Mock fetch
global.fetch = jest.fn();

describe('BankDetailsModal - Rapid Click Protection', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    xlmAmount: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Mock successful API responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/banks')) {
        return Promise.resolve({
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
          json: () =>
            Promise.resolve({
              success: true,
              data: { account_name: 'Test Account' },
            }),
        });
      }
      if (url.includes('/api/create-recipient')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              success: true,
              data: { recipient_code: 'RCP_test123' },
            }),
        });
      }
      if (url.includes('/api/initiate-transfer')) {
        return Promise.resolve({
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
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should prevent duplicate payout confirmations on rapid clicks', async () => {
    render(<BankDetailsModal {...defaultProps} />);

    // Wait for banks to load
    await waitFor(() => {
      expect(screen.getByText('Test Bank')).toBeInTheDocument();
    });

    // Select bank
    fireEvent.click(screen.getByText('Test Bank'));

    // Enter account number
    const accountInput = screen.getByPlaceholderText(/account number/i);
    fireEvent.change(accountInput, { target: { value: '1234567890' } });

    // Verify account
    const verifyButton = screen.getByText(/verify/i);
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText(/Test Account/i)).toBeInTheDocument();
    });

    // Proceed to confirmation
    const continueButton = screen.getByText(/continue/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      const confirmButton = screen.getByText(/confirm payout/i);
      expect(confirmButton).toBeInTheDocument();
    });

    const confirmButton = screen.getByText(/confirm payout/i);

    // Rapidly click confirm button
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // Should only call create-recipient once
      const createRecipientCalls = (global.fetch as jest.Mock).mock.calls.filter(
        (call) => call[0].includes('/api/create-recipient')
      );
      expect(createRecipientCalls).toHaveLength(1);
    });
  });

  it('should include idempotency key in API requests', async () => {
    render(<BankDetailsModal {...defaultProps} />);

    // Navigate through the flow
    await waitFor(() => {
      expect(screen.getByText('Test Bank')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Bank'));

    const accountInput = screen.getByPlaceholderText(/account number/i);
    fireEvent.change(accountInput, { target: { value: '1234567890' } });

    const verifyButton = screen.getByText(/verify/i);
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText(/Test Account/i)).toBeInTheDocument();
    });

    const continueButton = screen.getByText(/continue/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      const confirmButton = screen.getByText(/confirm payout/i);
      expect(confirmButton).toBeInTheDocument();
    });

    const confirmButton = screen.getByText(/confirm payout/i);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const createRecipientCall = (global.fetch as jest.Mock).mock.calls.find(
        (call) => call[0].includes('/api/create-recipient')
      );
      
      expect(createRecipientCall).toBeDefined();
      const options = createRecipientCall[1];
      expect(options.headers['X-Idempotency-Key']).toBeDefined();
      expect(options.headers['X-Idempotency-Key']).toMatch(/^payout_confirm_\d+_[a-z0-9]+$/);
    });
  });

  it('should disable button while processing', async () => {
    render(<BankDetailsModal {...defaultProps} />);

    // Navigate to confirmation step
    await waitFor(() => {
      expect(screen.getByText('Test Bank')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Bank'));

    const accountInput = screen.getByPlaceholderText(/account number/i);
    fireEvent.change(accountInput, { target: { value: '1234567890' } });

    const verifyButton = screen.getByText(/verify/i);
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText(/Test Account/i)).toBeInTheDocument();
    });

    const continueButton = screen.getByText(/continue/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      const confirmButton = screen.getByText(/confirm payout/i);
      expect(confirmButton).toBeInTheDocument();
    });

    const confirmButton = screen.getByText(/confirm payout/i);
    fireEvent.click(confirmButton);

    // Button should be disabled while processing
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });
  });

  it('should log suppressed duplicate payout attempts', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    render(<BankDetailsModal {...defaultProps} />);

    // Navigate to confirmation
    await waitFor(() => {
      expect(screen.getByText('Test Bank')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Bank'));

    const accountInput = screen.getByPlaceholderText(/account number/i);
    fireEvent.change(accountInput, { target: { value: '1234567890' } });

    const verifyButton = screen.getByText(/verify/i);
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText(/Test Account/i)).toBeInTheDocument();
    });

    const continueButton = screen.getByText(/continue/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      const confirmButton = screen.getByText(/confirm payout/i);
      expect(confirmButton).toBeInTheDocument();
    });

    const confirmButton = screen.getByText(/confirm payout/i);

    // Rapid clicks
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Suppressed duplicate'),
        expect.any(Object)
      );
    });
  });
});
