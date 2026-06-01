import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatInput from '../ChatInput';

const mockConnection = {
  address: '',
  publicKey: '',
  isConnected: false,
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
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/draftUtils', () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(() => ''),
  clearDraft: vi.fn(),
}));

describe('ChatInput - Wallet Disconnect Handling', () => {
  const mockOnSendMessage = vi.fn();
  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletContext.connection = { ...mockConnection, isConnected: false };
  });

  it('should show wallet disconnect warning when submitting without connected wallet', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(
      screen.getByText('Wallet disconnected. Reconnect to continue.'),
    ).toBeInTheDocument();
    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('should not send message when wallet is disconnected', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('should clear warning and allow submission when wallet reconnects', async () => {
    const { rerender } = render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(
      screen.getByText('Wallet disconnected. Reconnect to continue.'),
    ).toBeInTheDocument();

    // Simulate wallet reconnection
    mockWalletContext.connection = {
      ...mockConnection,
      isConnected: true,
      address: 'GABC123',
      publicKey: 'GABC123',
    };
    rerender(<ChatInput {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.queryByText('Wallet disconnected. Reconnect to continue.'),
      ).not.toBeInTheDocument();
    });
  });
});
