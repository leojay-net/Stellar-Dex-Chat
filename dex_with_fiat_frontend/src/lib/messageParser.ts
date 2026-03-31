import type { TransactionData } from '@/types';

export interface ParsedMessage {
  amount?: string;
  token?: string;
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

function extractToken(text: string): string | undefined {
  const match = text.match(TOKEN_PATTERN);
  if (match) return TOKEN_MAP[match[1].toLowerCase()];
  return undefined;
}

function extractFiatCurrency(text: string): string | undefined {
  const symbolMatch = text.match(FIAT_SYMBOL_PATTERN);
  if (symbolMatch) return FIAT_MAP[symbolMatch[1]];

  const wordMatch = text.match(FIAT_PATTERN);
  if (wordMatch) return FIAT_MAP[wordMatch[1].toLowerCase()];

  return undefined;
}

function extractAmount(text: string): string | undefined {
  const match = text.match(NUMBER_PATTERN);
  if (!match) return undefined;

  const raw = match[0].replace(/,/g, '');
  const num = parseFloat(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;

  return raw;
}

/**
 * Merge parser output into AI-extracted data. The parser takes precedence
 * for numeric fields (`amountIn`) because regex extraction is deterministic
 * and avoids AI hallucination of numbers. Non-numeric AI fields are preserved
 * when the parser has no opinion.
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
