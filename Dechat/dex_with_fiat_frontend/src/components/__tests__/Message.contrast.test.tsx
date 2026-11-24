import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/types';

const theme = vi.hoisted(() => ({ isDarkMode: false }));

vi.mock('@/contexts/StellarWalletContext', () => ({
  useStellarWallet: () => ({ connection: { isConnected: true } }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: theme.isDarkMode }),
}));

vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ maskingEnabled: false, maskingStyle: 'full' }),
}));

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useMasking', () => ({
  useMasking: (content: string) => content,
}));

vi.mock('@/hooks/useCurrencyConversion', () => ({
  useCurrencyConversion: () => ({ displayText: '' }),
}));

const { default: Message } = await import('@/components/Message');

// Tailwind v3 palette values for the classes Message.tsx pairs together.
const TAILWIND: Record<string, string> = {
  white: '#ffffff',
  'gray-100': '#f3f4f6',
  'gray-300': '#d1d5db',
  'gray-400': '#9ca3af',
  'gray-600': '#4b5563',
  'gray-800': '#1f2937',
  'blue-300': '#93c5fd',
  'blue-400': '#60a5fa',
  'blue-600': '#2563eb',
  'blue-700': '#1d4ed8',
  'red-50': '#fef2f2',
};

// Page backgrounds from globals.css (`--background`).
const PAGE_LIGHT = '#f4f7fb';
const PAGE_DARK = '#020617';

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two sRGB hex colours. */
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** Extracts the Tailwind `text-*` colour class applied to an element. */
function textColorOf(el: HTMLElement): string {
  const match = Array.from(el.classList).find((c) =>
    /^text-(white|[a-z]+-\d{2,3})$/.test(c),
  );
  if (!match) throw new Error(`no text colour class on ${el.outerHTML}`);
  return TAILWIND[match.replace(/^text-/, '')];
}

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-contrast',
    role: 'assistant',
    content: 'See [the docs](https://stellar.org) for details.',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function renderMessage(message: ChatMessage) {
  return render(<Message message={message} onActionClick={vi.fn()} />);
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe('contrastRatio helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('confirms the previous link colour failed AA on the light bubble', () => {
    expect(
      contrastRatio(TAILWIND['blue-400'], TAILWIND['gray-100']),
    ).toBeLessThan(AA_TEXT);
    expect(
      contrastRatio(TAILWIND['gray-400'], TAILWIND['gray-100']),
    ).toBeLessThan(AA_TEXT);
  });
});

describe.each([
  {
    mode: 'light',
    isDarkMode: false,
    bubble: TAILWIND['gray-100'],
    page: PAGE_LIGHT,
  },
  {
    mode: 'dark',
    isDarkMode: true,
    bubble: TAILWIND['gray-800'],
    page: PAGE_DARK,
  },
])('Message colour contrast ($mode mode)', ({ isDarkMode, bubble, page }) => {
  beforeEach(() => {
    theme.isDarkMode = isDarkMode;
  });

  it('renders markdown links that meet AA on the assistant bubble', () => {
    renderMessage(assistantMessage());

    const link = screen.getByTestId('message-link');
    expect(link).toHaveClass('underline');
    expect(contrastRatio(textColorOf(link), bubble)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('renders the pending placeholder with AA contrast', () => {
    renderMessage(
      assistantMessage({
        content: '',
        metadata: { status: 'pending' },
      } as Partial<ChatMessage>),
    );

    const loading = screen.getByTestId('message-loading');
    expect(contrastRatio(textColorOf(loading), bubble)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('renders the timestamp with AA contrast on the page background', () => {
    renderMessage(assistantMessage());

    const timestamp = screen.getByTestId('message-timestamp');
    expect(contrastRatio(textColorOf(timestamp), page)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('renders delivery receipts that meet non-text contrast', () => {
    renderMessage({
      id: 'msg-user',
      role: 'user',
      content: 'hello',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      metadata: { deliveredAt: new Date('2026-01-01T00:00:01Z') },
    } as ChatMessage);

    const receipt = screen.getByLabelText(
      'Delivered',
    ) as unknown as HTMLElement;
    const colorClass = (receipt.getAttribute('class') ?? '')
      .split(/\s+/)
      .find((c) => c.startsWith('text-'));
    expect(colorClass).toBeDefined();
    const color = TAILWIND[colorClass!.replace(/^text-/, '')];
    expect(contrastRatio(color, page)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('Message colour contrast (user bubble)', () => {
  it('renders the pending placeholder in white on the blue bubble', () => {
    theme.isDarkMode = false;
    renderMessage({
      id: 'msg-user-pending',
      role: 'user',
      content: '',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      metadata: { status: 'pending' },
    } as ChatMessage);

    const loading = screen.getByTestId('message-loading');
    expect(loading).toHaveClass('text-white');
    expect(
      contrastRatio(TAILWIND.white, TAILWIND['blue-600']),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps links readable on the error bubble', () => {
    theme.isDarkMode = false;
    renderMessage(
      assistantMessage({
        error: {
          message: 'failed',
          timestamp: new Date('2026-01-01T00:00:00Z'),
          retryAttempts: 0,
        },
      } as Partial<ChatMessage>),
    );

    const link = screen.getByTestId('message-link');
    expect(
      contrastRatio(textColorOf(link), TAILWIND['red-50']),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
