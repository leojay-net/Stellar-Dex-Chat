import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Resolve real copy so the assertions below exercise the actual strings.
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

// react-markdown ships ESM-only deps that are noise for this test.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

const { default: Message } = await import('@/components/Message');
const { MAX_AUTO_RETRIES, RETRY_BASE_DELAY_MS } = await import(
  '@/hooks/useMessageRetry'
);

function failedMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Sorry, something went wrong.',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    error: {
      message: 'Message failed to send. Please try again.',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      retryAttempts: 0,
    },
    originalPayload: { content: 'Convert 100 XLM to USD' },
    ...overrides,
  };
}

describe('Message — failed message resend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('renders a retry action in the error state', () => {
    render(
      <Message
        message={failedMessage()}
        onActionClick={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('message-retry-button')).toBeTruthy();
  });

  it('omits the retry action when no handler is supplied', () => {
    render(<Message message={failedMessage()} onActionClick={vi.fn()} />);

    expect(screen.queryByTestId('message-retry-button')).toBeNull();
  });

  it('resends the original content, not the failure placeholder', () => {
    const onRetry = vi.fn();
    render(
      <Message
        message={failedMessage()}
        onActionClick={vi.fn()}
        onRetry={onRetry}
      />,
    );

    act(() => {
      screen.getByTestId('message-retry-button').click();
    });

    expect(onRetry).toHaveBeenCalledWith('msg-1', 'Convert 100 XLM to USD');
  });

  it('falls back to the message body when no original payload was captured', () => {
    const onRetry = vi.fn();
    render(
      <Message
        message={failedMessage({ originalPayload: undefined })}
        onActionClick={vi.fn()}
        onRetry={onRetry}
      />,
    );

    act(() => {
      screen.getByTestId('message-retry-button').click();
    });

    expect(onRetry).toHaveBeenCalledWith(
      'msg-1',
      'Sorry, something went wrong.',
    );
  });

  it('retries automatically with backoff and stops after the budget is spent', async () => {
    const onRetry = vi.fn();
    render(
      <Message
        message={failedMessage()}
        onActionClick={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(onRetry).not.toHaveBeenCalled();

    await advance(RETRY_BASE_DELAY_MS);
    expect(onRetry).toHaveBeenCalledTimes(1);

    await advance(RETRY_BASE_DELAY_MS * 2);
    expect(onRetry).toHaveBeenCalledTimes(2);

    await advance(RETRY_BASE_DELAY_MS * 4);
    expect(onRetry).toHaveBeenCalledTimes(MAX_AUTO_RETRIES);

    for (let i = 0; i < 40; i += 1) {
      await advance(250);
    }
    expect(onRetry).toHaveBeenCalledTimes(MAX_AUTO_RETRIES);
    expect(screen.getByTestId('message-retry-status').textContent).toContain(
      'exhausted',
    );
  });

  it('announces the countdown to the next automatic attempt', async () => {
    render(
      <Message
        message={failedMessage()}
        onActionClick={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    await advance(0);
    const status = screen.getByTestId('message-retry-status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Retrying automatically in 1s');
    expect(status.textContent).toContain(`of ${MAX_AUTO_RETRIES}`);
  });

  it('counts prior server-side attempts alongside client-side ones', async () => {
    render(
      <Message
        message={failedMessage({
          error: {
            message: 'Message failed to send. Please try again.',
            timestamp: new Date('2026-01-01T00:00:00Z'),
            retryAttempts: 2,
          },
        })}
        onActionClick={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('message-error').textContent).toContain(
      'Retry attempts: 2',
    );

    await advance(RETRY_BASE_DELAY_MS);
    expect(screen.getByTestId('message-error').textContent).toContain(
      'Retry attempts: 3',
    );
  });

  it('disables the button while a resend is in flight', () => {
    const onRetry = vi.fn(() => new Promise<void>(() => {}));
    render(
      <Message
        message={failedMessage()}
        onActionClick={vi.fn()}
        onRetry={onRetry}
      />,
    );

    const button = screen.getByTestId('message-retry-button');
    act(() => button.click());

    expect(button.hasAttribute('disabled')).toBe(true);
    act(() => button.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
