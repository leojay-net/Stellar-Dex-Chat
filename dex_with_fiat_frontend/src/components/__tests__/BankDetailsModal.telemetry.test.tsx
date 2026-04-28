import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import BankDetailsModal from '../BankDetailsModal';
import { chatTelemetry, setTelemetryConsent } from '@/lib/chatTelemetry';

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
}));

vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => ({}),
}));

vi.mock('@/hooks/useIdempotentAction', () => ({
  useIdempotentAction: () => ({
    execute: async (
      fn: (key: string) => Promise<void>,
      _actionName?: string,
    ) => {
      await fn('test-key');
      return null;
    },
    isProcessing: false,
  }),
}));

describe('BankDetailsModal telemetry', () => {
  beforeEach(() => {
    setTelemetryConsent(false);
    setTelemetryConsent(true);
    global.fetch = vi.fn().mockResolvedValue({
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
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits fiat payout open telemetry when the modal becomes visible', async () => {
    const spy = vi.spyOn(chatTelemetry, 'fiatPayoutStep');

    render(
      <BankDetailsModal isOpen onClose={vi.fn()} xlmAmount={12} />,
    );

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'open',
          step: 1,
          xlmAmount: 12,
        }),
      );
    });
  });

});
