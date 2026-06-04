import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import ChatInput from '../ChatInput';

// Regression tests for issue #632 — the ChatInput textarea must render a
// deterministic, theme-token-driven border colour (rather than relying on the
// Tailwind utility cascade) and must reflect the wallet-disconnected warning
// state on its border.

const mockConnection = {
  address: '',
  publicKey: '',
  isConnected: true,
  network: '',
  networkPassphrase: '',
};

const mockWalletContext = {
  connection: mockConnection,
  accounts: [],
  selectedAccountIndex: 0,
  selectAccount: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTx: vi.fn(),
  isFreighterInstalled: false,
  isLoading: false,
  error: null,
  sessionExpired: false,
  clearSessionExpired: vi.fn(),
  mockConnect: vi.fn(),
  isNetworkMismatch: false,
};

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => mockWalletContext,
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/draftUtils', () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(() => ''),
  clearDraft: vi.fn(),
}));

describe('ChatInput - textarea border colour (#632)', () => {
  const defaultProps = {
    onSendMessage: vi.fn(),
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletContext.connection = { ...mockConnection, isConnected: true };
  });

  it('applies the neutral theme-token border class by default', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    // The explicit theme-token border class (backed by --color-border) wins
    // over Tailwind's preflight border-color reset, so the colour is
    // deterministic rather than an incorrect cascade fallback.
    expect(textarea).toHaveClass('theme-input-border');
    expect(textarea).not.toHaveClass('theme-input-border-invalid');
    expect(textarea).toHaveAttribute('aria-invalid', 'false');
  });

  it('switches to the warning border class when the wallet is disconnected', () => {
    mockWalletContext.connection = { ...mockConnection, isConnected: false };
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    // Trigger a submit attempt while disconnected to raise the warning state.
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(textarea).toHaveClass('theme-input-border-invalid');
    expect(textarea).not.toHaveClass('theme-input-border');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
  });
});
