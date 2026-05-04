/**
 * Safely converts a timestamp value to a Date object.
 *
 * When ChatMessage objects are serialized to JSON (e.g. persisted in
 * localStorage) and then parsed back, the `timestamp` field becomes an ISO
 * string instead of a Date instance. Calling `.toLocaleTimeString()` on a
 * plain string throws a TypeError, which was the root cause of the
 * intermittent UI crash / rendering glitch reported in Message.tsx.
 */
export function toDate(value: Date | string | unknown): Date {
    if (value instanceof Date) return value;
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? new Date() : d;
}
