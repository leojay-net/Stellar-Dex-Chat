import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BankDetailsModal from '../BankDetailsModal';

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

describe('BankDetailsModal accessibility', () => {
  it('renders a polite live region for announcements', () => {
    render(
      <BankDetailsModal
        isOpen={true}
        onClose={() => undefined}
        xlmAmount={100}
      />,
    );

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
  });
});
