import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BankDetailsModal from '../BankDetailsModal';
import { chatTelemetry } from '@/lib/chatTelemetry';

// Mock dependencies
vi.mock('@/lib/chatTelemetry', () => ({
  chatTelemetry: {
    fiatPayoutStep: vi.fn(),
  },
}));

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

vi.mock('@/hooks/useIdempotentAction', () => ({
  useIdempotentAction: () => ({
    execute: async (fn: (key: string) => Promise<void>) => {
      await fn('test-key');
      return null;
    },
    isProcessing: false,
  }),
}));

vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: vi.fn(),
}));

vi.mock('@/lib/clientSession', () => ({
  getOrCreateClientSessionId: () => 'test-session-id',
}));

global.fetch = vi.fn();

describe('BankDetailsModal - Telemetry Tracking', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as unknown as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });
  });

  it('tracks modal open event', () => {
    render(
      <BankDetailsModal isOpen={true} onClose={mockOnClose} xlmAmount={100} />,
    );

    expect(chatTelemetry.fiatPayoutStep).toHaveBeenCalledWith({
      action: 'open',
      step: 1,
      xlmAmount: 100,
    });
  });

  it('tracks step changes', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as unknown as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 1,
            name: 'Test Bank',
            code: '001',
            active: true,
            country: 'NG',
            currency: 'NGN',
            type: 'nuban',
          },
        ],
      }),
    });

    render(
      <BankDetailsModal isOpen={true} onClose={mockOnClose} xlmAmount={100} />,
    );

    await waitFor(() => {
      expect(chatTelemetry.fiatPayoutStep).toHaveBeenCalledWith({
        action: 'step_change',
        step: 1,
        xlmAmount: 100,
      });
    });
  });

  it('tracks bank selection', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as unknown as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 1,
            name: 'Test Bank',
            code: '001',
            active: true,
            country: 'NG',
            currency: 'NGN',
            type: 'nuban',
          },
        ],
      }),
    });

    render(
      <BankDetailsModal isOpen={true} onClose={mockOnClose} xlmAmount={100} />,
    );

    await waitFor(() => {
      const bankButton = screen.getByText('Test Bank');
      expect(bankButton).toBeInTheDocument();
    });

    const bankButton = screen.getByText('Test Bank');
    fireEvent.click(bankButton);

    expect(chatTelemetry.fiatPayoutStep).toHaveBeenCalledWith({
      action: 'bank_selected',
      step: 1,
      xlmAmount: 100,
      bankCode: '001',
    });
  });

  it('tracks account verification success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as unknown as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 1,
              name: 'Test Bank',
              code: '001',
              active: true,
              country: 'NG',
              currency: 'NGN',
              type: 'nuban',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { account_name: 'John Doe' },
        }),
      });

    render(
      <BankDetailsModal isOpen={true} onClose={mockOnClose} xlmAmount={100} />,
    );

    await waitFor(() => {
      const bankButton = screen.getByText('Test Bank');
      fireEvent.click(bankButton);
    });

    const nextButton = screen.getByText('Next');
    fireEvent.click(nextButton);

    await waitFor(() => {
      const accountInput = screen.getByPlaceholderText('0000000000');
      expect(accountInput).toBeInTheDocument();
    });

    const accountInput = screen.getByPlaceholderText('0000000000');
    fireEvent.change(accountInput, { target: { value: '1234567890' } });
    fireEvent.blur(accountInput);

    await waitFor(() => {
      expect(chatTelemetry.fiatPayoutStep).toHaveBeenCalledWith({
        action: 'account_verify_success',
        step: 2,
        xlmAmount: 100,
      });
    });
  });

  it('tracks account verification failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as unknown as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 1,
              name: 'Test Bank',
              code: '001',
              active: true,
              country: 'NG',
              currency: 'NGN',
              type: 'nuban',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          message: 'Invalid account',
        }),
      });

    render(
      <BankDetailsModal isOpen={true} onClose={mockOnClose} xlmAmount={100} />,
    );

    await waitFor(() => {
      const bankButton = screen.getByText('Test Bank');
      fireEvent.click(bankButton);
    });

    const nextButton = screen.getByText('Next');
    fireEvent.click(nextButton);

    await waitFor(() => {
      const accountInput = screen.getByPlaceholderText('0000000000');
      expect(accountInput).toBeInTheDocument();
    });

    const accountInput = screen.getByPlaceholderText('0000000000');
    fireEvent.change(accountInput, { target: { value: '1234567890' } });
    fireEvent.blur(accountInput);

    await waitFor(() => {
      expect(chatTelemetry.fiatPayoutStep).toHaveBeenCalledWith({
        action: 'account_verify_fail',
        step: 2,
        xlmAmount: 100,
        errorMessage: 'Invalid account',
      });
    });
  });

  it('tracks modal close event', () => {
    render(
      <BankDetailsModal isOpen={true} onClose={mockOnClose} xlmAmount={100} />,
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(chatTelemetry.fiatPayoutStep).toHaveBeenCalledWith({
      action: 'close',
      step: 1,
      xlmAmount: 100,
    });
  });
});
