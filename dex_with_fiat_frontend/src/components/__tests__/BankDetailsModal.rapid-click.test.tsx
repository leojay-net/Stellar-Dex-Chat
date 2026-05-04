import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import BankDetailsModal from '../BankDetailsModal';
import * as cryptoPriceService from '@/lib/cryptoPriceService';

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
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  xlmAmount: 10,
};

function makeFetch() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/api/banks')) {
      return { ok: true, json: async () => ({ success: true, data: [{ id: 1, name: 'Test Bank', code: '001', active: true }] }) };
    }
    if (url.includes('/api/verify-account')) {
      return { ok: true, json: async () => ({ success: true, data: { account_name: 'Test Account' } }) };
    }
    if (url.includes('/api/create-recipient')) {
      return { ok: true, json: async () => ({ success: true, data: { recipient_code: 'RCP_test123' } }) };
    }
    if (url.includes('/api/initiate-transfer')) {
      return { ok: true, json: async () => ({ success: true, data: { reference: 'TRF_test123', transfer_code: 'TRF_test123', status: 'pending' } }) };
    }
    throw new Error(`Unhandled: ${url}`);
  });
}

async function navigateToConfirm() {
  // Wait for banks to load
  await screen.findByText('Test Bank');
  
  // Step 1: select bank, then click Next
  fireEvent.click(screen.getByText('Test Bank'));
  
  await waitFor(() => {
    const nextBtn = screen.getAllByRole('button', { name: /next/i }).find(btn => !btn.hasAttribute('disabled'));
    if (!nextBtn) throw new Error('Next button 1 not enabled');
    fireEvent.click(nextBtn);
  });

  // Wait for Step 2 to appear
  await screen.findByText(/Enter your account number/i);

  // Step 2: enter account number, blur to trigger verification
  const accountInput = await screen.findByPlaceholderText(/0000000000/i);
  fireEvent.change(accountInput, { target: { value: '1234567890' } });
  fireEvent.blur(accountInput);

  // Wait for account name to appear after verification
  await screen.findByText(/Test Account/i);

  // Click Next on step 2
  await waitFor(() => {
    const nextBtn = screen.getAllByRole('button', { name: /next/i }).find(btn => !btn.hasAttribute('disabled'));
    if (!nextBtn) throw new Error('Next button 2 not enabled');
    fireEvent.click(nextBtn);
  });

  // Wait for confirm page
  return await screen.findByRole('button', { name: /confirm payout/i });
}

describe('BankDetailsModal - Rapid Click Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockImplementation(makeFetch() as any);
    // Re-apply after clearAllMocks wipes the implementation
    vi.spyOn(cryptoPriceService, 'fetchLockedQuote').mockResolvedValue({
      ngnAmount: 1000,
      xlmAmount: 10,
      rate: 100,
      expiresAt: Date.now() + 120000,
    } as any);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should prevent duplicate payout confirmations on rapid clicks', async () => {
    render(<BankDetailsModal {...defaultProps} />);
    const confirmButton = await navigateToConfirm();

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls.filter((c: any[]) => c[0].includes('/api/create-recipient'));
      expect(calls.length).toBe(1);
    });
  });

  it('should include idempotency key in API requests', async () => {
    render(<BankDetailsModal {...defaultProps} />);
    const confirmButton = await navigateToConfirm();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const call = (global.fetch as any).mock.calls.find((c: any[]) => c[0].includes('/api/create-recipient'));
      expect(call).toBeDefined();
      expect(call[1].headers['X-Idempotency-Key']).toBeDefined();
    });
  });

  it('should disable the confirm button once clicked', async () => {
    render(<BankDetailsModal {...defaultProps} />);
    const confirmButton = await navigateToConfirm();

    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton);

    // After click, the payout is processing — button becomes disabled
    await waitFor(() => {
      expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
