import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatXlm,
  formatPercent,
  formatRelativeTime,
} from './formatters';

describe('formatters', () => {
  it('formats currency per locale', () => {
    expect(formatCurrency(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatCurrency(1234.5, 'USD', 'de-DE')).toContain('1.234,50');
    expect(formatCurrency(1500, 'JPY', 'en-US')).toContain('1,500');
  });

  it('formats XLM per locale', () => {
    expect(formatXlm(1234.5, 'en-US')).toBe('1,234.50 XLM');
    expect(formatXlm(1234.5, 'fr-FR')).toContain('XLM');
  });

  it('formats percent with sign', () => {
    expect(formatPercent(2.5, 'en-US')).toBe('+2.50%');
    expect(formatPercent(-1.2, 'en-US')).toBe('-1.20%');
  });

  it('formats relative time', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 3 * 60_000, now, 'en-US')).toBe(
      '3 minutes ago',
    );
    expect(formatRelativeTime(now - 3 * 60_000, now, 'fr-FR')).toContain('3');
  });
});
