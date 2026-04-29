/**
 * Regression tests for the Message.tsx memory-leak / rendering-crash fix.
 *
 * Root cause: ChatMessage.timestamp is typed as Date, but after
 * JSON.parse(JSON.stringify(message)) (e.g. localStorage round-trip) the
 * value becomes an ISO string. The original code called
 * message.timestamp.toLocaleTimeString() directly, which throws a TypeError
 * on a string and caused intermittent UI crashes.
 *
 * Fix: toDate() normalises any incoming value to a valid Date before use.
 */
import { describe, it, expect } from 'vitest';
import { toDate } from './messageUtils';

describe('toDate — Message.tsx timestamp regression', () => {
    it('returns the same Date instance when given a real Date', () => {
        const d = new Date('2024-01-15T10:30:00.000Z');
        const result = toDate(d);
        expect(result).toBe(d);
    });

    it('parses an ISO string (localStorage round-trip) without throwing', () => {
        const iso = '2024-01-15T10:30:00.000Z';
        // This is the scenario that caused the crash: timestamp was a string
        expect(() => toDate(iso)).not.toThrow();
        const result = toDate(iso);
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toBe(iso);
    });

    it('toLocaleTimeString() does not throw on the result of toDate(string)', () => {
        const iso = '2024-06-01T14:05:00.000Z';
        // Simulates the exact call in Message.tsx that was crashing
        expect(() =>
            toDate(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ).not.toThrow();
    });

    it('returns a valid fallback Date for a completely invalid value', () => {
        const before = Date.now();
        const result = toDate('not-a-date');
        const after = Date.now();
        expect(result).toBeInstanceOf(Date);
        // Fallback should be approximately "now"
        expect(result.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('handles null gracefully', () => {
        expect(() => toDate(null)).not.toThrow();
        expect(toDate(null)).toBeInstanceOf(Date);
    });

    it('handles undefined gracefully', () => {
        expect(() => toDate(undefined)).not.toThrow();
        expect(toDate(undefined)).toBeInstanceOf(Date);
    });

    it('handles a numeric timestamp (milliseconds)', () => {
        const ms = 1700000000000;
        const result = toDate(ms);
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBe(ms);
    });
});
