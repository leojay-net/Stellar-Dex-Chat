import type { TransactionData } from '@/types';

/**
 * Result of a deterministic regex-based parse of a user chat message.
 *
 * All fields are optional — the parser may not find every component in
 * every message.  When a field is absent the calling code should fall
 * back to AI extraction (see {@link mergeParserWithAI}).
 *
 * @example
 * ```ts
 * // "send 100 XLM to NGN"
 * const result: ParsedMessage = { amount: "100", token: "XLM", fiatCurrency: "NGN" };
 * ```
 */
export interface ParsedMessage {
  /** Raw numeric string (e.g. `"100"`, `"50.5"`).  Commas stripped. */
  amount?: string;
  /** Normalised token symbol, `"XLM"` currently the only supported value. */
  token?: string;
  /** Normalised ISO 4217 fiat code (`"NGN"`, `"USD"`, `"EUR"`, `"GBP"`). */
  fiatCurrency?: string;
}

const FIAT_MAP: Record<string, string> = {
  ngn: 'NGN',
  naira: 'NGN',
  '₦': 'NGN',
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  $: 'USD',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  '€': 'EUR',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  '£': 'GBP',
};

const TOKEN_MAP: Record<string, string> = {
  xlm: 'XLM',
  lumens: 'XLM',
  lumen: 'XLM',
  stellar: 'XLM',
};

const FIAT_PATTERN = new RegExp(
  `\\b(${Object.keys(FIAT_MAP)
    .filter((k) => /^[a-z]/.test(k))
    .join('|')})\\b`,
  'i',
);

const FIAT_SYMBOL_PATTERN = /([₦$€£])/;

const TOKEN_PATTERN = new RegExp(
  `\\b(${Object.keys(TOKEN_MAP).join('|')})\\b`,
  'i',
);

// Matches numbers with optional commas and decimals: 1000, 1,000, 50.5, 1,000.50
const NUMBER_PATTERN = /\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/;

/**
 * Extract amount, token, and fiat currency from a user message using
 * deterministic regex rules. Runs before (and is merged with) AI extraction
 * so that numeric fields have a reliable, non-hallucinated source of truth.
 *
 * @param message - Raw user message (e.g. `"send 100 XLM"`, `"50 usd"`).
 * @returns A {@link ParsedMessage} with whichever fields could be matched.
 *          Returns an empty object when the input is empty or nothing matches.
 *
 * @example
 * ```ts
 * parseMessage("send 100 XLM to NGN");
 * // → { amount: "100", token: "XLM", fiatCurrency: "NGN" }
 *
 * parseMessage("how much is XLM today?");
 * // → { token: "XLM" }   // no amount or fiat found
 * ```
 *
 * @see {@link mergeParserWithAI} for combining parser output with AI data.
 */
export function parseMessage(message: string): ParsedMessage {
  const result: ParsedMessage = {};
  const normalized = message.trim();
  if (!normalized) return result;

  result.token = extractToken(normalized);
  result.fiatCurrency = extractFiatCurrency(normalized);
  result.amount = extractAmount(normalized);

  return result;
}

/**
 * Match a recognised token alias against the message text.
 *
 * Currently only Stellar lumens are supported; see {@link TOKEN_MAP}
 * for the full list of recognised aliases.
 *
 * @param text - Normalised message string.
 * @returns The normalised token symbol (`"XLM"`) or `undefined`.
 */
function extractToken(text: string): string | undefined {
  const match = text.match(TOKEN_PATTERN);
  if (match) return TOKEN_MAP[match[1].toLowerCase()];
  return undefined;
}

/**
 * Match a recognised fiat currency alias or symbol.
 *
 * Tries symbol characters first (e.g. `₦`, `$`), then falls back to
 * word matching (e.g. `"naira"`, `"dollar"`).  See {@link FIAT_MAP}
 * for the full list.
 *
 * @param text - Normalised message string.
 * @returns The normalised ISO 4217 code (`"NGN"`, `"USD"`, `"EUR"`, `"GBP"`)
 *          or `undefined` when no match is found.
 */
function extractFiatCurrency(text: string): string | undefined {
  const symbolMatch = text.match(FIAT_SYMBOL_PATTERN);
  if (symbolMatch) return FIAT_MAP[symbolMatch[1]];

  const wordMatch = text.match(FIAT_PATTERN);
  if (wordMatch) return FIAT_MAP[wordMatch[1].toLowerCase()];

  return undefined;
}

/**
 * Extract the first numeric value from a message string.
 *
 * Supports comma-grouped thousands (`1,000`) and decimal fractions (`50.5`).
 * Returns the raw digits (commas stripped) so callers can control formatting.
 * Zero and negative values are rejected.
 *
 * @param text - Normalised message string.
 * @returns The raw number string (e.g. `"100"`, `"50.5"`) or `undefined`
 *          when no valid number is present.
 */
function extractAmount(text: string): string | undefined {
  const match = text.match(NUMBER_PATTERN);
  if (!match) return undefined;

  const raw = match[0].replace(/,/g, '');
  const num = parseFloat(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;

  return raw;
}

/**
 * Merge parser output into AI-extracted data.
 *
 * The parser takes precedence for numeric fields (`amountIn`, `tokenIn`,
 * `fiatCurrency`) because regex extraction is deterministic and avoids
 * AI hallucination of numbers or symbols.  Non-numeric AI fields are
 * preserved when the parser has no opinion.
 *
 * @param parserResult - Output from {@link parseMessage}.
 * @param aiData - Partially filled data from the AI analysis pass.
 * @returns A merged copy; the original `aiData` object is not mutated.
 *
 * @example
 * ```ts
 * const parserResult: ParsedMessage = { amount: "100", token: "XLM" };
 * const aiData: Partial<TransactionData> = { fiatCurrency: "NGN" };
 *
 * mergeParserWithAI(parserResult, aiData);
 * // → { amountIn: "100", tokenIn: "XLM", fiatCurrency: "NGN" }
 * ```
 */
export function mergeParserWithAI(
  parserResult: ParsedMessage,
  aiData: Partial<TransactionData>,
): Partial<TransactionData> {
  const merged = { ...aiData };

  if (parserResult.amount) {
    merged.amountIn = parserResult.amount;
  }

  if (parserResult.token) {
    merged.tokenIn = parserResult.token;
  }

  if (parserResult.fiatCurrency) {
    merged.fiatCurrency = parserResult.fiatCurrency;
  }

  return merged;
}
