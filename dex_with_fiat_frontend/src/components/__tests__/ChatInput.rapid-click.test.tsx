import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatInput from '../ChatInput';

// Mock the translation context
vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock draft utils
vi.mock('@/lib/draftUtils', () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(() => ''),
  clearDraft: vi.fn(),
}));

// Mock stellar wallet context
vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: { isConnected: true },
  }),
}));

describe('ChatInput - Rapid Click Protection', () => {
  const mockOnSendMessage = vi.fn();
  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should prevent duplicate message submissions on rapid keyboard shortcut presses', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    // Type a message
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    // Rapidly press Ctrl+Enter multiple times
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      // Should only send once
      expect(mockOnSendMessage).toHaveBeenCalled();
    }, { timeout: 2000 });
    
    expect(mockOnSendMessage).toHaveBeenCalledTimes(1);
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
  });

  it('should prevent duplicate submissions on rapid button clicks', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    // Type a message
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    const submitButton = screen.getByRole('button', {
      name: /send message \(ctrl\+enter\)/i,
    });

    // Rapidly click the submit button
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSendMessage).toHaveBeenCalled();
    });
    
    expect(mockOnSendMessage).toHaveBeenCalledTimes(1);
  });
});
