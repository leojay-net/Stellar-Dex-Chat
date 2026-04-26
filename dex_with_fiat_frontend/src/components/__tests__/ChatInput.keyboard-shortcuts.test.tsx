import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatInput from '../ChatInput';

// Mock the translation context
jest.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock draft utils
jest.mock('@/lib/draftUtils', () => ({
  saveDraft: jest.fn(),
  getDraft: jest.fn(() => ''),
  clearDraft: jest.fn(),
}));

// Mock StellarWalletContext
jest.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: {
      isConnected: true,
      address: 'GABC123',
      publicKey: 'GABC123',
      network: 'testnet',
      networkPassphrase: '',
    },
  }),
}));

describe('ChatInput - Keyboard Shortcuts', () => {
  const mockOnSendMessage = jest.fn();
  const mockOnCancelRequest = jest.fn();
  const mockOnNewChat = jest.fn();
  const mockOnOpenHistory = jest.fn();
  const mockOnOpenBridgeModal = jest.fn();

  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    onCancelRequest: mockOnCancelRequest,
    onNewChat: mockOnNewChat,
    onOpenHistory: mockOnOpenHistory,
    onOpenBridgeModal: mockOnOpenBridgeModal,
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should trigger new chat with Cmd+N', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(mockOnNewChat).toHaveBeenCalledTimes(1);
  });

  it('should trigger new chat with Ctrl+N', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(mockOnNewChat).toHaveBeenCalledTimes(1);
  });

  it('should not trigger new chat with Shift+Cmd+N', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true });
    expect(mockOnNewChat).not.toHaveBeenCalled();
  });

  it('should trigger open history with Cmd+H', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'h', metaKey: true });
    expect(mockOnOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('should trigger open history with Ctrl+H', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    expect(mockOnOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('should trigger open bridge modal with Cmd+B', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(mockOnOpenBridgeModal).toHaveBeenCalledTimes(1);
  });

  it('should trigger open bridge modal with Ctrl+B', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(mockOnOpenBridgeModal).toHaveBeenCalledTimes(1);
  });

  it('should trigger cancel request with Cmd+Shift+C', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'c', metaKey: true, shiftKey: true });
    expect(mockOnCancelRequest).toHaveBeenCalledTimes(1);
  });

  it('should trigger cancel request with Ctrl+Shift+C', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true, shiftKey: true });
    expect(mockOnCancelRequest).toHaveBeenCalledTimes(1);
  });

  it('should not trigger cancel request with Cmd+C', () => {
    render(<ChatInput {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    expect(mockOnCancelRequest).not.toHaveBeenCalled();
  });

  it('should toggle command palette with Cmd+K', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument();
  });

  it('should toggle command palette with Ctrl+K', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument();
  });
});