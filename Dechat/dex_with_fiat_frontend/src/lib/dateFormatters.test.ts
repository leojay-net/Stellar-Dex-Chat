import { describe, expect, it } from 'vitest';

import { formatDateTime, formatRelativeHistoryDate } from './dateFormatters';

describe('formatRelativeHistoryDate', () => {
  const now = new Date(2026, 5, 25, 0, 10);

  it.each([
    ['en', 'Yesterday'],
    ['fr', 'Hier'],
    ['es', 'Ayer'],
  ] as const)(
    'uses the %s yesterday translation at midnight',
    (locale, label) => {
      const lateYesterday = new Date(2026, 5, 24, 23, 50);

      expect(formatRelativeHistoryDate(lateYesterday, locale, label, now)).toBe(
        label,
      );
    },
  );

  it.each(['en', 'fr', 'es'] as const)(
    'formats relative days with the %s locale',
    (locale) => {
      const twoDaysAgo = new Date(2026, 5, 23, 23, 50);
      const expected = new Intl.RelativeTimeFormat(locale, {
        numeric: 'auto',
      }).format(-2, 'day');

      expect(
        formatRelativeHistoryDate(twoDaysAgo, locale, 'Yesterday', now),
      ).toBe(expected);
    },
  );
});

describe('formatDateTime', () => {
  it.each(['en', 'fr', 'es'] as const)(
    'formats dates with the %s locale',
    (locale) => {
      const date = new Date(2026, 5, 25, 13, 5);

      expect(formatDateTime(date, locale, { dateStyle: 'medium' })).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date),
      );
    },
  );
});
