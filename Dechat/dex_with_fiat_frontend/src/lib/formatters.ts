export function formatCurrency(
  value: number,
  currency = 'USD',
  locale = 'en-US',
): string {
  const abs = Math.abs(value);
  const digits =
    currency.toUpperCase() === 'JPY' || currency.toUpperCase() === 'NGN'
      ? 0
      : abs < 1
        ? 4
        : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatXlm(value: number, locale = 'en-US'): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 7 }).format(value)} XLM`;
}

/** `value` is a percentage, e.g. 2.5 means 2.5%. */
export function formatPercent(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(value / 100);
}

export function formatRelativeTime(
  timestamp: number,
  now = Date.now(),
  locale = 'en-US',
): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
