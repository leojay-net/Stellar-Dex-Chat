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
 * Raised when a value cannot be read as a stroop count.
 *
 * `BigInt` rejects fractional and exponent strings with a bare `SyntaxError`,
 * which a caller cannot tell apart from an unrelated parse failure, while an
 * empty string is silently read as `0n`. Neither is a usable stroop count, so
 * both are reported as this type instead.
 */
export class StroopsFormatError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super(`Expected a base-10 integer stroop count, received ${String(value)}`);
    this.name = 'StroopsFormatError';
    this.value = value;
  }
}

/**
 * Reads a raw stroop count from a `bigint` or from a base-10 integer string
 * (optionally signed) as returned by RPC/JSON payloads.
 *
 * @returns The parsed count, or `null` when the input is not a base-10 integer.
 */
function parseStroops(stroops: bigint | string): bigint | null {
  if (typeof stroops === 'bigint') {
    return stroops;
  }

  const normalized = stroops.trim();

  if (!/^[+-]?\d+$/.test(normalized)) {
    return null;
  }

  return BigInt(normalized);
}

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
 * - Splits the magnitude into a whole part and a fractional remainder.
 * - Computes the whole integer portion via `magnitude / 10_000_000n` (integer division).
 * - Computes the fractional remainder via `magnitude % 10_000_000n` (modulo division).
 * - Formats the fractional remainder as a 7-character zero-padded string and trims redundant trailing zeros.
 * - Preprends `-` once, after formatting, so negatives keep the sign in front of the whole part.
 *
 * @param stroops - The stroop value to format, provided as a `bigint` or string integer (e.g. `50000000n` or `"50000000"`).
 * @returns Formatted XLM string (e.g. `"5"` for `50_000_000n`, `"0.5"` for `5_000_000n`).
 * @throws {StroopsFormatError} If `stroops` is a string that is not a base-10 integer.
 *
 * @example
 * ```typescript
 * stroopsToXlm(10000000n); // "1"
 * stroopsToXlm(1005000000n); // "100.5"
 * stroopsToXlm("1"); // "0.0000001"
 * stroopsToXlm(-5000000n); // "-0.5"
 * ```
 */
export function stroopsToXlm(stroops: bigint | string): string {
  const value = parseStroops(stroops);

  if (value === null) {
    throw new StroopsFormatError(stroops);
  }

  // The magnitude is formatted first and the sign is attached afterwards.
  // Formatting the signed value directly is what produced "0.00000-5" for -5n:
  // `-5n / 10_000_000n` truncates to `0n` while `-5n % 10_000_000n` keeps the
  // sign, and that remainder is then left-padded into the fractional slot.
  const isNegative = value < 0n;
  const magnitude = isNegative ? -value : value;
  const whole = magnitude / DIVISOR;
  const frac = magnitude % DIVISOR;
  const fracStr = frac.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  const formatted = fracStr ? `${whole}.${fracStr}` : `${whole}`;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats a raw stroop value for display without throwing.
 *
 * Display paths render values straight from API payloads, where a malformed
 * amount should degrade to a placeholder rather than take the view down.
 * Arithmetic and validation paths should call {@link stroopsToXlm} instead so
 * that bad input fails loudly.
 *
 * @param stroops - The stroop value to format.
 * @returns The formatted XLM string, or `null` when the input cannot be parsed.
 */
export function stroopsToXlmOrNull(stroops: bigint | string): string | null {
  try {
    return stroopsToXlm(stroops);
  } catch {
    return null;
  }
}

/**
 * Legacy alias for {@link stroopsToXlm}.
 * @deprecated Use {@link stroopsToXlm} directly instead.
 */
export const stroopsToDisplay = stroopsToXlm;

