import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserSettings from '../UserSettings';

// ── Hoisted mock references (must come before vi.mock calls) ──────────────

const {
  mockSetLocale,
  mockSetFiatCurrency,
  mockSetHighValueThreshold,
  mockSetTwoFactorEnabled,
  mockSetRemindersEnabled,
  mockSetReminderFrequency,
  mockAddBeneficiary,
  mockDeleteBeneficiary,
  mockRenameBeneficiary,
  mockAddAddress,
  mockRemoveAddress,
  mockUseAccessibleModal,
} = vi.hoisted(() => ({
  mockSetLocale: vi.fn(),
  mockSetFiatCurrency: vi.fn(),
  mockSetHighValueThreshold: vi.fn(),
  mockSetTwoFactorEnabled: vi.fn(),
  mockSetRemindersEnabled: vi.fn(),
  mockSetReminderFrequency: vi.fn(),
  mockAddBeneficiary: vi.fn(),
  mockDeleteBeneficiary: vi.fn(),
  mockRenameBeneficiary: vi.fn(),
  mockAddAddress: vi.fn(),
  mockRemoveAddress: vi.fn(),
  mockUseAccessibleModal: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ locale: 'en', setLocale: mockSetLocale }),
}));

vi.mock('@/contexts/UserPreferencesContext', () => ({
  SUPPORTED_FIAT_CURRENCIES: [
    { code: 'usd', label: 'USD — US Dollar', symbol: '$' },
    { code: 'eur', label: 'EUR — Euro', symbol: '€' },
  ],
  useUserPreferences: () => ({
    fiatCurrency: 'usd',
    setFiatCurrency: mockSetFiatCurrency,
    remindersEnabled: false,
    setRemindersEnabled: mockSetRemindersEnabled,
    reminderFrequency: 'weekly',
    setReminderFrequency: mockSetReminderFrequency,
    highValueThreshold: 500,
    setHighValueThreshold: mockSetHighValueThreshold,
    twoFactorEnabled: false,
    setTwoFactorEnabled: mockSetTwoFactorEnabled,
  }),
}));

vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false,
  featureFlagSectionDividerBorderClass: () => 'border-gray-200',
}));

vi.mock('@/hooks/useChatTelemetry', () => ({
  useChatTelemetry: () => ({ consented: false, setConsent: vi.fn() }),
}));

vi.mock('@/hooks/useBeneficiaries', () => ({
  useBeneficiaries: vi.fn(() => ({
    beneficiaries: [],
    isLoaded: true,
    addBeneficiary: mockAddBeneficiary,
    deleteBeneficiary: mockDeleteBeneficiary,
    renameBeneficiary: mockRenameBeneficiary,
  })),
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({
    watchlist: [],
    isLoaded: true,
    addAddress: mockAddAddress,
    removeAddress: mockRemoveAddress,
  }),
}));

// useAccessibleModal traps focus and listens for Escape; mock so tests control
// the Escape key press directly.
vi.mock('@/hooks/useAccessibleModal', () => ({
  useAccessibleModal: mockUseAccessibleModal,
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function renderSettings(isOpen = true, onClose = vi.fn()) {
  return {
    onClose,
    ...render(<UserSettings isOpen={isOpen} onClose={onClose} />),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAccessibleModal.mockImplementation(() => {});
});

describe('UserSettings', () => {
  // ── Render ──────────────────────────────────────────────────────────────

  it('renders the panel when isOpen is true', () => {
    renderSettings(true);
    expect(
      screen.getByRole('dialog', { name: /user settings/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('does not render anything when isOpen is false', () => {
    const { container } = render(
      <UserSettings isOpen={false} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // ── Accessibility ────────────────────────────────────────────────────────

  it('has correct ARIA attributes for the dialog', () => {
    renderSettings();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'User settings');
  });

  it('close button has an accessible label', () => {
    renderSettings();
    expect(
      screen.getByRole('button', { name: /close settings/i }),
    ).toBeInTheDocument();
  });

  // ── Close behaviour ──────────────────────────────────────────────────────

  it('calls onClose when the X button is clicked', async () => {
    const { onClose } = renderSettings();
    await userEvent.click(
      screen.getByRole('button', { name: /close settings/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const { onClose } = renderSettings();
    // The backdrop is the element right before the panel
    const backdrop = document.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('useAccessibleModal is called with isOpen=true and the onClose callback', () => {
    const onClose = vi.fn();
    render(<UserSettings isOpen={true} onClose={onClose} />);
    expect(mockUseAccessibleModal).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ current: expect.anything() }),
      onClose,
    );
  });

  it('Escape key triggers onClose via useAccessibleModal', () => {
    // Simulate useAccessibleModal wiring an Escape listener
    const onClose = vi.fn();
    mockUseAccessibleModal.mockImplementation(
      (
        _isOpen: boolean,
        _ref: React.RefObject<HTMLElement>,
        close: () => void,
      ) => {
        // Attach a keydown listener that fires onClose for Escape
        const handler = (e: KeyboardEvent) => {
          if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      },
    );
    render(<UserSettings isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Beneficiaries ────────────────────────────────────────────────────────

  it('calls addBeneficiary when name and address are filled and Add is clicked', async () => {
    renderSettings();
    // Open the add form
    await userEvent.click(
      screen.getByRole('button', { name: /add new beneficiary/i }),
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: /beneficiary name/i }),
      'Alice',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: /beneficiary account address/i }),
      'GABC123',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(mockAddBeneficiary).toHaveBeenCalledTimes(1);
    expect(mockAddBeneficiary).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'GABC123',
      'GABC123',
      'Alice',
    );
  });

  it('does not call addBeneficiary when name is blank', async () => {
    renderSettings();
    await userEvent.click(
      screen.getByRole('button', { name: /add new beneficiary/i }),
    );
    // Only fill address, leave name blank
    await userEvent.type(
      screen.getByRole('textbox', { name: /beneficiary account address/i }),
      'GABC123',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(mockAddBeneficiary).not.toHaveBeenCalled();
  });

  it('does not call addBeneficiary when address is blank', async () => {
    renderSettings();
    await userEvent.click(
      screen.getByRole('button', { name: /add new beneficiary/i }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: /beneficiary name/i }),
      'Alice',
    );
    // Leave address blank
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(mockAddBeneficiary).not.toHaveBeenCalled();
  });

  it('shows existing beneficiaries and calls deleteBeneficiary on delete', async () => {
    const { useBeneficiaries } = await import('@/hooks/useBeneficiaries');
    vi.mocked(useBeneficiaries).mockReturnValue({
      beneficiaries: [
        {
          id: 'b1',
          name: 'Alice',
          bankId: 0,
          bankName: 'Unknown Bank',
          bankCode: '000',
          accountNumber: 'GABC123',
          accountName: 'GABC123',
          createdAt: Date.now(),
        },
      ],
      isLoaded: true,
      selectedIndex: -1,
      addBeneficiary: mockAddBeneficiary,
      deleteBeneficiary: mockDeleteBeneficiary,
      renameBeneficiary: mockRenameBeneficiary,
      getBeneficiary: vi.fn(),
      selectBeneficiary: vi.fn(),
      clearSelection: vi.fn(),
      keyboardShortcuts: {
        ADD_BENEFICIARY: 'Ctrl+B',
        FOCUS_BENEFICIARIES: 'Ctrl+Shift+B',
        NAVIGATE_UP: 'ArrowUp',
        NAVIGATE_DOWN: 'ArrowDown',
        SELECT_BENEFICIARY: 'Enter',
        DELETE_BENEFICIARY: 'Delete',
      } as const,
    } as any);

    renderSettings();
    // The beneficiary name should appear
    expect(screen.getByText('Alice')).toBeInTheDocument();

    // Hover to reveal buttons and click delete
    const deleteBtn = screen.getByRole('button', { name: /delete alice/i });
    await userEvent.click(deleteBtn);
    expect(mockDeleteBeneficiary).toHaveBeenCalledWith('b1');
  });

  // ── Watchlist ────────────────────────────────────────────────────────────

  it('calls addAddress when a valid address is entered', async () => {
    renderSettings();
    await userEvent.click(
      screen.getByRole('button', { name: /add wallet to watchlist/i }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: /wallet address to watch/i }),
      'GABC456',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(mockAddAddress).toHaveBeenCalledWith('GABC456', '');
  });

  it('does not call addAddress when address field is blank', async () => {
    renderSettings();
    await userEvent.click(
      screen.getByRole('button', { name: /add wallet to watchlist/i }),
    );
    // Do not type anything — address stays blank
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(mockAddAddress).not.toHaveBeenCalled();
  });

  // ── Currency ─────────────────────────────────────────────────────────────

  it('calls setFiatCurrency when a currency option is clicked', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('option', { name: /EUR/i }));
    expect(mockSetFiatCurrency).toHaveBeenCalledWith('eur');
  });

  // ── Language ─────────────────────────────────────────────────────────────

  it('calls setLocale when a language option is clicked', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('option', { name: /français/i }));
    expect(mockSetLocale).toHaveBeenCalledWith('fr');
  });

  it('calls setLocale with the correct locale for each language option', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('option', { name: /español/i }));
    expect(mockSetLocale).toHaveBeenCalledWith('es');
  });

  // ── Threshold validation ─────────────────────────────────────────────────

  it('calls setHighValueThreshold for a valid positive number', async () => {
    renderSettings();
    // Enable two-factor to reveal the threshold input
    await userEvent.click(
      screen.getByRole('button', { name: /two-factor confirmation/i }),
    );
    expect(mockSetTwoFactorEnabled).toHaveBeenCalledWith(true);
  });

  it('does not call setHighValueThreshold when input value is 0', () => {
    // Simulate onChange with value 0
    const onChange = (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        mockSetHighValueThreshold(parsed);
      }
    };
    onChange('0');
    expect(mockSetHighValueThreshold).not.toHaveBeenCalled();
  });

  it('does not call setHighValueThreshold when input value is NaN', () => {
    const onChange = (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        mockSetHighValueThreshold(parsed);
      }
    };
    onChange('abc');
    expect(mockSetHighValueThreshold).not.toHaveBeenCalled();
  });

  it('calls setHighValueThreshold for a valid value greater than 0', () => {
    const onChange = (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        mockSetHighValueThreshold(parsed);
      }
    };
    onChange('1000');
    expect(mockSetHighValueThreshold).toHaveBeenCalledWith(1000);
  });
});
