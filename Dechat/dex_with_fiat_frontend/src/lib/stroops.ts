/**
 * @fileoverview Precision-safe stroop and XLM currency conversion utilities.
 *
 * Stellar assets utilize 7 decimal places of precision, where 1 XLM = 10,000,000 stroops (10^7).
 * To prevent IEEE-754 64-bit binary floating-point representation drift (e.g. `0.1 + 0.2 !== 0.3`)
 * and JavaScript integer overflow beyond `Number.MAX_SAFE_INTEGER` (2^53 - 1 ≈ 9.007 × 10^15),
 * all calculations in this module utilize string-based decimal parsing and native `BigInt` arithmetic.
 */

/** Number of decimal places used by Stellar Lumens (XLM) and SAC tokens (10^7). */
const DECIMALS = 7;

/** BigInt scaling multiplier (10,000,000n) representing one full XLM in stroops. */
const DIVISOR = BigInt(10 ** DECIMALS);

/**
 * Converts a human-readable decimal XLM amount string or number to raw stroops (1 XLM = 10,000,000 stroops).
 *
 * ### Overflow & Precision Prevention Architecture
 * - **Zero Floating-Point Math**: Avoids `parseFloat` / `Number()` multiplication which suffers from
 *   binary float rounding errors and overflows `Number.MAX_SAFE_INTEGER`.
 * - **String-Based Decimal Splitting**: Divides the input into integer (`wholePart`) and fractional (`fractionalPart`)
 *   components, padding the fractional part to exactly 7 digits.
 * - **Strict Boundary Regex**: Enforces that input contains only non-negative numeric digits with at most 7 decimal
 *   fraction places (`/^\d*(?:\.\d{0,7})?$/`). Rejects negative signs, malformed characters, and sub-stroop precision.
 * - **BigInt Scaling**: Evaluates `BigInt(whole) * 10_000_000n + BigInt(fraction)` in arbitrary-precision integer space.
 *
 * @param xlm - The XLM amount to convert, represented as a decimal string (e.g. `"100.5"`) or number.
 * @returns The converted amount in stroops as a `bigint`, or `null` if input is empty, negative, or malformed.
 *
 * @example
 * ```typescript
 * xlmToStroops("1"); // 10000000n
 * xlmToStroops("0.0000001"); // 1n (1 stroop)
 * xlmToStroops("100.5"); // 1005000000n
 * xlmToStroops("0.00000001"); // null (exceeds 7 decimals)
 * xlmToStroops("-5"); // null (negative numbers rejected)
 * ```
 */
export function xlmToStroops(xlm: string | number): bigint | null {
  const normalized = String(xlm).trim();

  if (!normalized) {
    return null;
  }

  if (!/^\d*(?:\.\d{0,7})?$/.test(normalized)) {
    return null;
  }

  const [wholePart = '0', fractionalPart = ''] = normalized.split('.');

  if (!wholePart && !fractionalPart) {
    return null;
  }

  const whole = wholePart || '0';
  const fraction = (fractionalPart || '').padEnd(DECIMALS, '0');
  return BigInt(whole) * DIVISOR + BigInt(fraction || '0');
}

/**
 * Formats a raw stroop value as a human-readable decimal XLM string with zero float truncation.
 *
 * ### Mathematical Mechanics
 * - Computes the whole integer portion via `value / 10_000_000n` (integer division).
 * - Computes the fractional remainder via `value % 10_000_000n` (modulo division).
 * - Formats the fractional remainder as a 7-character zero-padded string and trims redundant trailing zeros.
 *
 * @param stroops - The stroop value to format, provided as a `bigint` or string integer (e.g. `50000000n` or `"50000000"`).
 * @returns Formatted XLM string (e.g. `"5"` for `50_000_000n`, `"0.5"` for `5_000_000n`).
 *
 * @example
 * ```typescript
 * stroopsToXlm(10000000n); // "1"
 * stroopsToXlm(1005000000n); // "100.5"
 * stroopsToXlm("1"); // "0.0000001"
 * ```
 */
export function stroopsToXlm(stroops: bigint | string): string {
  const value = typeof stroops === 'string' ? BigInt(stroops) : stroops;
  const whole = value / DIVISOR;
  const frac = value % DIVISOR;
  const fracStr = frac.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/**
 * Legacy alias for {@link stroopsToXlm}.
 * @deprecated Use {@link stroopsToXlm} directly instead.
 */
export const stroopsToDisplay = stroopsToXlm;

