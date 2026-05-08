import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import BankDetailsModal from '../BankDetailsModal';
import { bankDetailsSchema } from '../BankDetailsModal';

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ addNotification: vi.fn() }),
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
    execute: async (fn: (key: string) => Promise<void>) => { await fn('test-key'); },
    isProcessing: false,
  }),
}));
vi.mock('@/lib/chatTelemetry', () => ({
  chatTelemetry: { fiatPayoutStep: vi.fn() },
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  xlmAmount: 10,
};

describe('BankDetailsModal - Zod Schema (unit)', () => {
  it('rejects account numbers shorter than 10 digits', () => {
    const result = bankDetailsSchema.pick({ accountNumber: true }).safeParse({ accountNumber: '123' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Account number must be exactly 10 digits');
  });

  it('rejects account numbers containing non-digit characters', () => {
    const result = bankDetailsSchema.pick({ accountNumber: true }).safeParse({ accountNumber: '123456789a' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Account number must be exactly 10 digits');
  });

  it('accepts a valid 10-digit account number', () => {
    const result = bankDetailsSchema.pick({ accountNumber: true }).safeParse({ accountNumber: '1234567890' });
    expect(result.success).toBe(true);
  });

  it('rejects saveCustomName longer than 50 characters', () => {
    const result = bankDetailsSchema.pick({ saveCustomName: true }).safeParse({
      saveCustomName: 'A'.repeat(51),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('50');
  });

  it('rejects payoutNote longer than 160 characters', () => {
    const result = bankDetailsSchema.pick({ payoutNote: true }).safeParse({
      payoutNote: 'x'.repeat(161),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('160');
  });

  it('accepts an empty optional payoutNote', () => {
    const result = bankDetailsSchema.pick({ payoutNote: true }).safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('BankDetailsModal - Zod Validation (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/api/banks')) {
        return { ok: true, json: async () => ({ success: true, data: [{ id: 1, name: 'Test Bank', code: '001', active: true }] }) } as Response;
      }
      throw new Error(`Unhandled: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows Zod error when account number is not 10 digits', async () => {
    render(<BankDetailsModal {...defaultProps} />);

    // Wait for banks to load, select bank, go to step 2
    await waitFor(() => { expect(screen.getByText('Test Bank')).toBeDefined(); });
    fireEvent.click(screen.getByText('Test Bank'));
    const nextBtn = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextBtn);

    // Step 2: type an invalid account number and blur
    const accountInput = await screen.findByPlaceholderText(/0000000000/i);
    fireEvent.change(accountInput, { target: { value: '123' } });
    fireEvent.blur(accountInput);

    await waitFor(() => {
      expect(screen.getByText(/Account number must be exactly 10 digits/i)).toBeDefined();
    });
  });

  it('clears error when a valid 10-digit number is entered', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('/api/banks')) {
        return { ok: true, json: async () => ({ success: true, data: [{ id: 1, name: 'Test Bank', code: '001', active: true }] }) } as Response;
      }
      if (url.includes('/api/verify-account')) {
        return { ok: true, json: async () => ({ success: true, data: { account_name: 'Test Account' } }) } as Response;
      }
      throw new Error(`Unhandled: ${url}`);
    });

    render(<BankDetailsModal {...defaultProps} />);

    await waitFor(() => { expect(screen.getByText('Test Bank')).toBeDefined(); });
    fireEvent.click(screen.getByText('Test Bank'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const accountInput = await screen.findByPlaceholderText(/0000000000/i);

    // First type invalid
    fireEvent.change(accountInput, { target: { value: '123' } });
    fireEvent.blur(accountInput);
    await waitFor(() => { expect(screen.getByText(/Account number must be exactly 10 digits/i)).toBeDefined(); });

    // Now change to valid — error should clear
    fireEvent.change(accountInput, { target: { value: '1234567890' } });
    fireEvent.blur(accountInput);
    await waitFor(() => {
      expect(screen.queryByText(/Account number must be exactly 10 digits/i)).toBeNull();
    });
  });
});
