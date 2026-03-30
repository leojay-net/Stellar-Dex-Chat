import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatInput from '../ChatInput';
import * as draftUtils from '@/lib/draftUtils';

// Mock the translation context
jest.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock draft utils
jest.mock('@/lib/draftUtils', () => ({
  saveDraft: jest.fn(),
  getDraft: jest.fn(),
  clearDraft: jest.fn(),
}));

// Mock Stellar Wallet context
jest.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: { isConnected: true },
  }),
}));

describe('ChatInput - Draft Persistence', () => {
  const mockOnSendMessage = jest.fn();
  const sessionId = 'test-session-123';
  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    isLoading: false,
    placeholder: 'Type a message...',
    sessionId: sessionId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should restore draft from draftUtils on mount', () => {
    (draftUtils.getDraft as jest.Mock).mockReturnValue('Restored draft content');
    
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Restored draft content');
    expect(draftUtils.getDraft).toHaveBeenCalledWith(sessionId);
  });

  it('should save draft to draft store on keystroke with 500ms debounce', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'T' } });
    fireEvent.change(textarea, { target: { value: 'Te' } });
    fireEvent.change(textarea, { target: { value: 'Test' } });

    // Should not have called saveDraft yet due to debounce
    expect(draftUtils.saveDraft).not.toHaveBeenCalled();

    // Advance time by 500ms
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(draftUtils.saveDraft).toHaveBeenCalledWith(sessionId, 'Test');
    expect(draftUtils.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('should clear draft on successful send', async () => {
    (draftUtils.getDraft as jest.Mock).mockReturnValue('Message to send');
    render(<ChatInput {...defaultProps} />);
    
    const submitButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSendMessage).toHaveBeenCalledWith('Message to send');
      expect(draftUtils.clearDraft).toHaveBeenCalledWith(sessionId);
    });
  });

  it('should persist draft across "reloads" (unmount and remount)', async () => {
    const { unmount } = render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;

    // Type something
    fireEvent.change(textarea, { target: { value: 'Persistent message' } });

    // Advance timers to trigger save
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(draftUtils.saveDraft).toHaveBeenCalledWith(sessionId, 'Persistent message');

    // Unmount (simulating page exit/reload context)
    unmount();

    // Mock getDraft to return the saved value for the next mount
    (draftUtils.getDraft as jest.Mock).mockReturnValue('Persistent message');

    // Remount
    render(<ChatInput {...defaultProps} />);
    const newTextarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    
    expect(newTextarea.value).toBe('Persistent message');
  });
});