export type DateLocale = 'en' | 'fr' | 'es';

function calendarDayTimestamp(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDateTime(
  date: Date,
  locale: DateLocale,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatRelativeHistoryDate(
  date: Date,
  locale: DateLocale,
  yesterdayLabel: string,
  now: Date = new Date(),
): string {
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) {
    return '';
  }

  const dayDifference =
    (calendarDayTimestamp(date) - calendarDayTimestamp(now)) /
    (24 * 60 * 60 * 1000);

  if (dayDifference === 0) {
    return formatDateTime(date, locale, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (dayDifference === -1) return yesterdayLabel;
  if (Math.abs(dayDifference) < 7) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      dayDifference,
      'day',
    );
  }

  return formatDateTime(date, locale, { dateStyle: 'medium' });
}
