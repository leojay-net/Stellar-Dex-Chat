/**
 * Text Masking Utilities
 * Provides functions to mask sensitive terms in text
 */

import { SensitiveTermsManager } from './sensitiveTerms';

export type MaskingStyle = 'asterisk' | 'block' | 'initial' | 'pipe';

export interface MaskingOptions {
  style?: MaskingStyle;
  manager?: SensitiveTermsManager;
}

/**
 * Generate mask character(s) for a term
 */
export function generateMask(term: string, style: MaskingStyle = 'asterisk'): string {
  const length = term.length;

  switch (style) {
    case 'block':
      // e.g., "damn" -> "████"
      return '█'.repeat(length);

    case 'initial':
      // e.g., "damn" -> "d***"
      if (length <= 1) return '*';
      return term.charAt(0) + '*'.repeat(length - 1);

    case 'pipe':
      // e.g., "damn" -> "|dam|"
      return `|${term}|`;

    case 'asterisk':
    default:
      // e.g., "damn" -> "****"
      return '*'.repeat(length);
  }
}

/**
 * Mask a single term in text at a specific position
 */
export function maskTermAtPosition(
  text: string,
  index: number,
  length: number,
  maskString: string,
): string {
  return text.substring(0, index) + maskString + text.substring(index + length);
}

/**
 * Mask all sensitive terms in text
 */
export function maskText(
  text: string,
  manager: SensitiveTermsManager,
  style: MaskingStyle = 'asterisk',
): string {
  const matches = manager.findSensitiveTerms(text);

  if (matches.length === 0) {
    return text;
  }

  // Process matches in reverse order to maintain correct indices
  let result = text;
  let offset = 0;

  for (const match of matches) {
    const mask = generateMask(match.term, style);
    const adjustedIndex = match.index + offset;
    const beforeMatch = result.substring(0, adjustedIndex);
    const afterMatch = result.substring(adjustedIndex + match.length);

    result = beforeMatch + mask + afterMatch;
    offset += mask.length - match.length;
  }

  return result;
}

/**
 * Get masking statistics for text
 */
export function getMaskingStats(
  text: string,
  manager: SensitiveTermsManager,
): {
  totalTermsFound: number;
  uniqueTerms: Set<string>;
  byCategory: Record<string, number>;
} {
  const matches = manager.findSensitiveTerms(text);
  const uniqueTerms = new Set(matches.map((m) => m.term));
  const byCategory: Record<string, number> = {};

  for (const match of matches) {
    const category = match.config.category;
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  return {
    totalTermsFound: matches.length,
    uniqueTerms,
    byCategory,
  };
}

export default maskText;
