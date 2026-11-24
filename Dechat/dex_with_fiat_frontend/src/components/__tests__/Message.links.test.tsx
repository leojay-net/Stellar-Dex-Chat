import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

vi.mock('@/contexts/TranslationContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useMasking', () => ({
  useMasking: (content: string) => content,
}));

vi.mock('@/hooks/useCurrencyConversion', () => ({
  useCurrencyConversion: () => ({ displayText: '' }),
}));

// NOTE: react-markdown is deliberately NOT mocked here (unlike the other
// Message tests) — the point is to exercise its real URL handling together
// with our `urlTransform` and link/image renderers (#1498).

const { default: Message } = await import('@/components/Message');

function assistantMessage(content: string): ChatMessage {
  return {
    id: 'msg-links',
    role: 'assistant',
    content,
    timestamp: new Date('2026-01-01T00:00:00Z'),
  };
}

function renderMarkdown(content: string) {
  return render(
    <Message message={assistantMessage(content)} onActionClick={vi.fn()} />,
  );
}

describe('Message — assistant markdown links (#1498)', () => {
  describe.each([
    ['javascript:', '[click me](javascript:alert(1))'],
    ['mixed-case javascript:', '[click me](JaVaScRiPt:alert(1))'],
    ['percent-encoded javascript:', '[click me](javas%63ript:alert(1))'],
    ['vbscript:', '[click me](vbscript:msgbox(1))'],
    [
      'data: html',
      '[click me](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    ],
    ['file:', '[click me](file:///etc/passwd)'],
  ])('blocks a %s link', (_label, markdown) => {
    it('is not clickable and keeps its text visible', () => {
      const { container } = renderMarkdown(markdown);

      expect(screen.queryByRole('link')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
      expect(container.innerHTML).not.toMatch(/href=/i);
      expect(screen.getByText('click me')).toBeTruthy();
    });
  });

  it('renders a safe https link as a hardened external link', () => {
    renderMarkdown('[docs](https://example.com/docs)');

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps http, mailto and relative links working', () => {
    renderMarkdown(
      '[a](http://example.com) [b](mailto:hi@example.com) [c](/relative/path)',
    );

    const hrefs = screen
      .getAllByRole('link')
      .map((el) => el.getAttribute('href'));
    expect(hrefs).toEqual([
      'http://example.com',
      'mailto:hi@example.com',
      '/relative/path',
    ]);
  });

  it('shows a blocked image as its alt text, without an <img>', () => {
    const { container } = renderMarkdown(
      '![tracking pixel](javascript:alert(1))',
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('tracking pixel')).toBeTruthy();
  });

  it('blocks a data: image', () => {
    const { container } = renderMarkdown(
      '![inline](data:image/svg+xml;base64,PHN2Zy8+)',
    );

    expect(container.querySelector('img')).toBeNull();
  });

  it('still renders a safe https image', () => {
    const { container } = renderMarkdown(
      '![logo](https://example.com/logo.png)',
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/logo.png');
    expect(img?.getAttribute('alt')).toBe('logo');
  });
});
