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
  selectAccount: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  signTx: jest.fn(),
  isFreighterInstalled: false,
  isLoading: false,
  error: null,
  sessionExpired: false,
  clearSessionExpired: jest.fn(),
  mockConnect: jest.fn(),
  isNetworkMismatch: false,
};

jest.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => mockWalletContext,
}));

jest.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/lib/draftUtils', () => ({
  saveDraft: jest.fn(),
  getDraft: jest.fn(() => ''),
  clearDraft: jest.fn(),
}));

describe('ChatInput - Wallet Disconnect Handling', () => {
  const mockOnSendMessage = jest.fn();
  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletContext.connection = { ...mockConnection, isConnected: false };
  });

  it('should show wallet disconnect warning when submitting without connected wallet', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Wallet disconnected. Reconnect to continue.')).toBeInTheDocument();
    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('should not send message when wallet is disconnected', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('should clear warning and allow submission when wallet reconnects', async () => {
    const { rerender } = render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Wallet disconnected. Reconnect to continue.')).toBeInTheDocument();

    // Simulate wallet reconnection
    mockWalletContext.connection = {
      ...mockConnection,
      isConnected: true,
      address: 'GABC123',
      publicKey: 'GABC123',
    };
    rerender(<ChatInput {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText('Wallet disconnected. Reconnect to continue.')).not.toBeInTheDocument();
    });
  });
});
