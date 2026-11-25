export const STROOPS_PER_UNIT = 10_000_000n; // 7 decimals; ADAPT if your token differs
const DAY_MS = 86_400_000;

/** Day index used for rollover. ADAPT: must match how the contract defines "a day" (UTC days assumed). */
export function dayIndex(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

export function msUntilNextDay(nowMs: number): number {
  return (dayIndex(nowMs) + 1) * DAY_MS - nowMs;
}

/** remaining = cap - used, never below zero. */
export function remainingOf(cap: bigint, used: bigint): bigint {
  return used >= cap ? 0n : cap - used;
}

/** "12.5" -> 125000000n. Returns null for empty or invalid input. */
export function parseAmountToStroops(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{0,7})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(7, '0'));
}

/** 125000000n -> "12.5" */
export function formatStroops(v: bigint): string {
  const whole = v / STROOPS_PER_UNIT;
  const frac = (v % STROOPS_PER_UNIT)
    .toString()
    .padStart(7, '0')
    .replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * Turn whatever a daily view returns into "used today".
 * ADAPT: console.log the raw value once and tighten this to the real shape.
 * Accepts a bare number/bigint, or an object with an amount and an optional day.
 */
export function usedToday(raw: unknown, nowMs: number): bigint {
  if (raw == null) return 0n;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') return BigInt(Math.trunc(raw));
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const amount = r.amount ?? r.total ?? r.deposited ?? r.withdrawn ?? 0n;
    const day = r.day ?? r.day_index ?? r.last_day;
    // A record from an earlier day means nothing has been used today.
    if (day != null && Number(day) !== dayIndex(nowMs)) return 0n;
    return BigInt(amount as bigint | number | string);
  }
  return 0n;
}
