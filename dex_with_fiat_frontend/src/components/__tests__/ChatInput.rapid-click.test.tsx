import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('ChatInput - Rapid Click Protection', () => {
  const mockOnSendMessage = jest.fn();
  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should prevent duplicate message submissions on rapid Enter key presses', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    // Type a message
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    // Rapidly press Enter multiple times
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      // Should only send once
      expect(mockOnSendMessage).toHaveBeenCalledTimes(1);
      expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
    });
  });

  it('should prevent duplicate submissions on rapid button clicks', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    
    // Type a message
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    const submitButton = screen.getByRole('button', { name: /submit/i });

    // Rapidly click the submit button
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => {
      // Should only send once
      expect(mockOnSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  it('should disable submit button while processing', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    const submitButton = screen.getByRole('button', { name: /submit/i });

    // Click submit
    fireEvent.click(submitButton);

    // Button should be disabled immediately
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
  });

  it('should allow submission after cooldown period', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    // First submission
    fireEvent.change(textarea, { target: { value: 'First message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockOnSendMessage).toHaveBeenCalledTimes(1);
    });

    // Wait for cooldown (1000ms)
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Second submission
    fireEvent.change(textarea, { target: { value: 'Second message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockOnSendMessage).toHaveBeenCalledTimes(2);
      expect(mockOnSendMessage).toHaveBeenNthCalledWith(2, 'Second message');
    });
  });

  it('should not submit when isLoading is true', async () => {
    render(<ChatInput {...defaultProps} isLoading={true} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('should log suppressed duplicate attempts', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');

    fireEvent.change(textarea, { target: { value: 'Test message' } });

    // Rapid submissions
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Suppressed duplicate'),
        expect.any(Object)
      );
    });
  });

  it('should clear input after successful submission', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Test message' } });
    expect(textarea.value).toBe('Test message');

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('should handle form submission event', async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message...');
    const form = textarea.closest('form');

    fireEvent.change(textarea, { target: { value: 'Test message' } });

    // Submit the form
    if (form) {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(mockOnSendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
