import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/types';

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({ connection: { isConnected: true } }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ maskingEnabled: false, maskingStyle: 'full' }),
}));

vi.mock('@/contexts/TranslationContext', async () => {
  const en = (await import('@/locales/en.json')).default as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslation: () => ({
      t: (key: string, params?: Record<string, string | number>) => {
        const [section, name] = key.split('.');
        const value = en[section]?.[name] ?? key;
        return params
          ? Object.entries(params).reduce(
              (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
              value,
            )
          : value;
      },
    }),
  };
});

vi.mock('@/hooks/useMasking', () => ({
  useMasking: (content: string) => content,
}));

vi.mock('@/hooks/useCurrencyConversion', () => ({
  useCurrencyConversion: () => ({ displayText: '' }),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

const { default: Message } = await import('@/components/Message');

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-kb',
    role: 'assistant',
    content: 'Test message',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    metadata: { status: 'sent' },
    ...overrides,
  };
}

function failedMessage(): ChatMessage {
  return makeMessage({
    role: 'user',
    content: 'Failed',
    error: {
      message: 'Failed to send',
      timestamp: new Date(),
      retryAttempts: 0,
    },
    originalPayload: { content: 'Original text' },
    metadata: { status: 'failed' },
  });
}

describe('Message — keyboard shortcuts (#683)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('R key — retry', () => {
    it('calls onRetry when R is pressed on a failed message', () => {
      const onRetry = vi.fn();
      render(
        <Message
          message={failedMessage()}
          onActionClick={vi.fn()}
          onRetry={onRetry}
        />,
      );

      const messageEl = screen.getByTestId('message');
      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'r', bubbles: true }),
        );
      });

      expect(onRetry).toHaveBeenCalledWith('msg-kb', 'Original text');
    });

    it('does not call onRetry when R is pressed on a non-failed message', () => {
      const onRetry = vi.fn();
      render(
        <Message
          message={makeMessage()}
          onActionClick={vi.fn()}
          onRetry={onRetry}
        />,
      );

      const messageEl = screen.getByTestId('message');
      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'r', bubbles: true }),
        );
      });

      expect(onRetry).not.toHaveBeenCalled();
    });

    it('ignores R when Ctrl is held', () => {
      const onRetry = vi.fn();
      render(
        <Message
          message={failedMessage()}
          onActionClick={vi.fn()}
          onRetry={onRetry}
        />,
      );

      const messageEl = screen.getByTestId('message');
      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true }),
        );
      });

      expect(onRetry).not.toHaveBeenCalled();
    });

    it('ignores R when Meta is held', () => {
      const onRetry = vi.fn();
      render(
        <Message
          message={failedMessage()}
          onActionClick={vi.fn()}
          onRetry={onRetry}
        />,
      );

      const messageEl = screen.getByTestId('message');
      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true }),
        );
      });

      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('Escape key — blur', () => {
    it('blurs the message element when Escape is pressed', () => {
      render(
        <Message
          message={makeMessage()}
          onActionClick={vi.fn()}
        />,
      );

      const messageEl = screen.getByTestId('message');
      messageEl.focus();
      expect(document.activeElement).toBe(messageEl);

      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      });

      expect(document.activeElement).not.toBe(messageEl);
    });
  });

  describe('C key — copy tx hash', () => {
    it('copies transaction hash to clipboard when C is pressed', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(
        <Message
          message={makeMessage({
            metadata: {
              status: 'sent',
              transactionData: {
                type: 'fiat_conversion',
                txHash: '0xabc123',
              },
            },
          })}
          onActionClick={vi.fn()}
        />,
      );

      const messageEl = screen.getByTestId('message');
      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'c', bubbles: true }),
        );
      });

      expect(writeText).toHaveBeenCalledWith('0xabc123');
    });

    it('does not call clipboard when no txHash is present', () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(
        <Message
          message={makeMessage()}
          onActionClick={vi.fn()}
        />,
      );

      const messageEl = screen.getByTestId('message');
      act(() => {
        messageEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'c', bubbles: true }),
        );
      });

      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('aria-keyshortcuts attribute', () => {
    it('includes R for failed messages', () => {
      render(
        <Message
          message={failedMessage()}
          onActionClick={vi.fn()}
          onRetry={vi.fn()}
        />,
      );

      const messageEl = screen.getByTestId('message');
      expect(messageEl.getAttribute('aria-keyshortcuts')).toContain('R');
    });

    it('does not include R for non-failed messages', () => {
      render(
        <Message
          message={makeMessage()}
          onActionClick={vi.fn()}
        />,
      );

      const messageEl = screen.getByTestId('message');
      expect(messageEl.getAttribute('aria-keyshortcuts')).not.toContain('R');
    });

    it('always includes C and Escape', () => {
      render(
        <Message
          message={makeMessage()}
          onActionClick={vi.fn()}
        />,
      );

      const messageEl = screen.getByTestId('message');
      const shortcuts = messageEl.getAttribute('aria-keyshortcuts');
      expect(shortcuts).toContain('C');
      expect(shortcuts).toContain('Escape');
    });
  });
});
