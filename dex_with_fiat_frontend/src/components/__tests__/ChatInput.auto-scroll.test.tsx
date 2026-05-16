import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ChatInput from '../ChatInput';

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

vi.mock('@/contexts/StellarWalletContext', () => ({
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

describe('ChatInput - Auto Scroll', () => {
  const mockOnSendMessage = vi.fn();

  const defaultProps = {
    onSendMessage: mockOnSendMessage,
    isLoading: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scrolls to the latest textarea content when input exceeds the maximum height', () => {
    render(<ChatInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(
      'Type a message...',
    ) as HTMLTextAreaElement;

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(textarea, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    const longMessage = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');

    fireEvent.change(textarea, { target: { value: longMessage } });
    fireEvent.input(textarea, { target: { value: longMessage } });

    expect(textarea.style.height).toBe('120px');
    expect(textarea.scrollTop).toBe(240);
  });
});
