import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ChatInput from '../ChatInput';

const mockUseMediaQuery = vi.fn();

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: (query: string) => mockUseMediaQuery(query),
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    connection: { isConnected: true },
  }),
}));

vi.mock('@/lib/draftUtils', () => ({
  saveDraft: vi.fn(),
  getDraft: vi.fn(() => ''),
  clearDraft: vi.fn(),
}));

vi.mock('@/hooks/useIdempotentAction', () => ({
  useIdempotentAction: () => ({
    execute: (fn: () => void) => fn(),
    isProcessing: false,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: 'div',
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

describe('ChatInput mobile layout', () => {
  const defaultProps = {
    onSendMessage: vi.fn(),
    isLoading: false,
  };

  beforeEach(() => {
    mockUseMediaQuery.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses inline layout on desktop viewports', () => {
    mockUseMediaQuery.mockReturnValue(false);
    render(React.createElement(ChatInput, defaultProps));

    expect(screen.getByTestId('chat-input-form').getAttribute('data-mobile-layout')).toBe(
      'inline',
    );
    expect(screen.getByTestId('chat-input-controls').className).toContain('items-end');
    expect(screen.getByTestId('chat-input-send').className).toContain('w-12');
  });

  it('uses stacked mobile layout below 640px', () => {
    mockUseMediaQuery.mockReturnValue(true);
    render(React.createElement(ChatInput, defaultProps));

    expect(screen.getByTestId('chat-input-form').getAttribute('data-mobile-layout')).toBe(
      'stacked',
    );
    expect(screen.getByTestId('chat-input-form').className).toContain('sticky');
    expect(screen.getByTestId('chat-input-controls').className).toContain('flex-col');
    expect(screen.getByTestId('chat-input-send').className).toContain('w-full');
  });

  it('queries the mobile breakpoint media query', () => {
    render(React.createElement(ChatInput, defaultProps));
    expect(mockUseMediaQuery).toHaveBeenCalledWith('(max-width: 639px)');
  });
});
