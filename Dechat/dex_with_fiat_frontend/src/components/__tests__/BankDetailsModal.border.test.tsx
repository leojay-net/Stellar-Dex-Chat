import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import BankDetailsModal from '../BankDetailsModal';

vi.mock('@/lib/cryptoPriceService', () => ({
  fetchLockedQuote: vi
    .fn()
    .mockResolvedValue({ ngnAmount: 1000, expiresAt: Date.now() + 120_000 }),
}));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ addNotification: vi.fn() }),
}));
vi.mock('@/hooks/useBeneficiaries', () => ({
  useBeneficiaries: () => ({
    beneficiaries: [
      {
        id: 'beneficiary-1',
        name: 'Saved account',
        bankId: 1,
        bankName: 'Test Bank',
        bankCode: '001',
        accountNumber: '1234567890',
        accountName: 'Test account holder',
        createdAt: 0,
      },
    ],
    isLoaded: true,
    addBeneficiary: vi.fn(),
    renameBeneficiary: vi.fn(),
    deleteBeneficiary: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTxHistory', () => ({
  useTxHistory: () => ({ addEntry: vi.fn() }),
}));
vi.mock('@/hooks/useAccessibleModal', () => ({ useAccessibleModal: vi.fn() }));
vi.mock('@/hooks/useIdempotentAction', () => ({
  useIdempotentAction: () => ({ execute: vi.fn(), isProcessing: false }),
}));
vi.mock('@/lib/chatTelemetry', () => ({
  chatTelemetry: { fiatPayoutStep: vi.fn() },
}));
vi.mock('@/lib/clientSession', () => ({
  getOrCreateClientSessionId: () => 'sess-1',
}));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      p: actual.motion.p,
      div: ({
        children,
        className,
        ...rest
      }: React.HTMLAttributes<HTMLDivElement>) => (
        <div className={className} {...rest}>
          {children}
        </div>
      ),
    },
    useReducedMotion: () => false,
  };
});

function renderModal() {
  return render(<BankDetailsModal isOpen xlmAmount={10} onClose={vi.fn()} />);
}

async function openAccountDetails() {
  fireEvent.click(await screen.findByRole('button', { name: 'Test Bank' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('BankDetailsModal border colours (#742)', () => {
  beforeEach(() => {
    const banks = [
      {
        id: 1,
        name: 'Test Bank',
        code: '001',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/banks') {
          return Response.json({ success: true, data: banks });
        }
        if (url === '/api/verify-account') {
          return Response.json({
            success: true,
            data: { account_name: 'Test account holder' },
          });
        }
        throw new Error(`Unexpected request to ${url}`);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('bank search input uses theme-input-border, not border-gray-600', async () => {
    renderModal();
    const search = await screen.findByPlaceholderText(/search banks/i);
    expect(search).toHaveClass('theme-input-border');
    expect(search).not.toHaveClass('border-gray-600');
  });

  it('bank search input has theme-input background/text class', async () => {
    renderModal();
    const search = await screen.findByPlaceholderText(/search banks/i);
    expect(search).toHaveClass('theme-input');
  });

  it('account number input uses theme-input-border in step 2', async () => {
    renderModal();
    await openAccountDetails();
    const account = screen.getByPlaceholderText('0000000000');
    expect(account).toHaveClass('theme-input-border');
    expect(account).not.toHaveClass('border-gray-600');
  });

  it('IBAN input neutral state uses theme-input-border, not border-gray-600', async () => {
    renderModal();
    await openAccountDetails();
    const iban = screen.getByPlaceholderText(/GB29/i);
    expect(iban).toHaveClass('theme-input-border');
    expect(iban).not.toHaveClass('border-gray-600');
  });

  it('IBAN input shows border-red-500 after blur with invalid value', async () => {
    renderModal();
    await openAccountDetails();
    const iban = screen.getByPlaceholderText(/GB29/i);
    fireEvent.change(iban, { target: { value: 'INVALID' } });
    fireEvent.blur(iban);
    expect(iban).toHaveClass('border-red-500');
    expect(iban).not.toHaveClass('border-green-500');
  });

  it('IBAN input shows border-green-500 after blur with valid GB IBAN', async () => {
    renderModal();
    await openAccountDetails();
    const iban = screen.getByPlaceholderText(/GB29/i);
    fireEvent.change(iban, { target: { value: 'GB29NWBK60161331926819' } });
    fireEvent.blur(iban);
    expect(iban).toHaveClass('border-green-500');
    expect(iban).not.toHaveClass('border-red-500');
  });

  it('beneficiary save and rename inputs use theme-input-border, not border-gray-600', async () => {
    renderModal();
    fireEvent.click(
      screen.getByRole('button', { name: /Use saved beneficiary/i }),
    );
    fireEvent.click(screen.getByTitle('Rename'));
    const rename = screen.getByDisplayValue('Saved account');
    expect(rename).toHaveClass('theme-input-border');
    expect(rename).not.toHaveClass('border-gray-600');

    await openAccountDetails();
    const account = screen.getByPlaceholderText('0000000000');
    fireEvent.change(account, { target: { value: '1234567890' } });
    fireEvent.blur(account);
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Save beneficiary for future use/i,
      }),
    );
    const save = screen.getByPlaceholderText('Test account holder');
    expect(save).toHaveClass('theme-input-border');
    expect(save).not.toHaveClass('border-gray-600');
  });
});
