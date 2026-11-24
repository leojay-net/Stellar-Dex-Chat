/**
 * Safely converts a timestamp value to a Date object.
 *
 * This function provides a robust way to handle timestamp values that may be
 * either Date instances or ISO strings. When ChatMessage objects are serialized
 * to JSON (e.g., persisted in localStorage) and then parsed back, the `timestamp`
 * field becomes an ISO string instead of a Date instance. Calling methods like
 * `.toLocaleTimeString()` on a plain string throws a TypeError, which was the
 * root cause of intermittent UI crashes/rendering glitches in Message.tsx.
 *
 * @param value - The timestamp value to convert. Can be a Date instance, an ISO
 *   string, or an unknown type (which will be handled gracefully).
 *
 * @returns A Date object. If the input is already a Date, it's returned as-is.
 *   If the input is a valid date string, it's parsed into a Date. If the input
 *   is invalid or cannot be parsed, returns the current date as a fallback.
 *
 * @throws This function does not throw exceptions. All error cases are handled
 *   by returning a fallback Date object to prevent UI crashes.
 *
 * @example
 * ```ts
 * // Convert a Date instance (no-op)
 * const date1 = new Date('2024-01-15T10:30:00Z');
 * const result1 = toDate(date1);
 * console.log(result1 === date1); // true
 *
 * // Convert an ISO string
 * const isoString = '2024-01-15T10:30:00Z';
 * const result2 = toDate(isoString);
 * console.log(result2 instanceof Date); // true
 * console.log(result2.toISOString()); // '2024-01-15T10:30:00.000Z'
 *
 * // Handle invalid input gracefully
 * const result3 = toDate('invalid-date');
 * console.log(result3 instanceof Date); // true (returns current date)
 *
 * // Handle unknown type
 * const result4 = toDate(undefined);
 * console.log(result4 instanceof Date); // true (returns current date)
 * ```
 *
 * @remarks
 * This function is particularly important in React components that display
 * timestamps, as it ensures consistent Date objects regardless of the data
 * source (API response vs. localStorage cache).
 */
export function toDate(value: Date | string | unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? new Date() : d;
}
