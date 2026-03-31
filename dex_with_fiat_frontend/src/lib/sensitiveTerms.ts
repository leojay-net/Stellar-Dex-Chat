/**
 * Sensitive Terms Configuration
 * Provides a configurable list of sensitive terms for content moderation
 */

export interface SensitiveTermConfig {
  term: string;
  category: 'profanity' | 'sensitive' | 'offensive' | 'custom';
  caseSensitive?: boolean;
  wholeWordOnly?: boolean;
}

// Default sensitive terms organized by category
const DEFAULT_SENSITIVE_TERMS: SensitiveTermConfig[] = [
  // Profanity - common profane words
  { term: 'damn', category: 'profanity', caseSensitive: false, wholeWordOnly: true },
  { term: 'hell', category: 'profanity', caseSensitive: false, wholeWordOnly: true },
  { term: 'crap', category: 'profanity', caseSensitive: false, wholeWordOnly: true },
  { term: 'ass', category: 'profanity', caseSensitive: false, wholeWordOnly: false },
  { term: 'piss', category: 'profanity', caseSensitive: false, wholeWordOnly: true },

  // Offensive terms
  { term: 'stupid', category: 'offensive', caseSensitive: false, wholeWordOnly: true },
  { term: 'idiot', category: 'offensive', caseSensitive: false, wholeWordOnly: true },
  { term: 'dumb', category: 'offensive', caseSensitive: false, wholeWordOnly: true },

  // Sensitive - could be inappropriate in business context
  { term: 'sucks', category: 'sensitive', caseSensitive: false, wholeWordOnly: true },
  { term: 'hate', category: 'sensitive', caseSensitive: false, wholeWordOnly: true },
  { term: 'kill', category: 'sensitive', caseSensitive: false, wholeWordOnly: true },
];

export class SensitiveTermsManager {
  private terms: Map<string, SensitiveTermConfig> = new Map();

  constructor(customTerms?: SensitiveTermConfig[]) {
    // Initialize with default terms
    this.addTerms(DEFAULT_SENSITIVE_TERMS);

    // Add custom terms if provided
    if (customTerms && customTerms.length > 0) {
      this.addTerms(customTerms);
    }
  }

  /**
   * Add sensitive terms to the manager
   */
  addTerms(terms: SensitiveTermConfig[]): void {
    terms.forEach((term) => {
      const key = term.caseSensitive ? term.term : term.term.toLowerCase();
      this.terms.set(key, term);
    });
  }

  /**
   * Remove a sensitive term
   */
  removeTerm(term: string, caseSensitive: boolean = false): void {
    const key = caseSensitive ? term : term.toLowerCase();
    this.terms.delete(key);
  }

  /**
   * Get all sensitive terms
   */
  getTerms(): SensitiveTermConfig[] {
    return Array.from(this.terms.values());
  }

  /**
   * Check if a term is sensitive
   */
  isSensitive(text: string): boolean {
    for (const [key, config] of this.terms) {
      if (this.matchesTerm(text, key, config)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find all sensitive terms in text
   */
  findSensitiveTerms(
    text: string,
  ): Array<{ term: string; index: number; length: number; config: SensitiveTermConfig }> {
    const results: Array<{
      term: string;
      index: number;
      length: number;
      config: SensitiveTermConfig;
    }> = [];

    for (const [key, config] of this.terms) {
      const matches = this.findMatches(text, key, config);
      results.push(
        ...matches.map((match) => ({
          term: match.term,
          index: match.index,
          length: match.length,
          config,
        })),
      );
    }

    // Sort by index to handle overlapping matches
    return results.sort((a, b) => a.index - b.index);
  }

  /**
   * Check if text matches a sensitive term
   */
  private matchesTerm(
    text: string,
    termKey: string,
    config: SensitiveTermConfig,
  ): boolean {
    const searchText = config.caseSensitive ? text : text.toLowerCase();
    const searchTerm = config.caseSensitive ? config.term : termKey;

    if (config.wholeWordOnly) {
      const regex = new RegExp(`\\b${this.escapeRegex(searchTerm)}\\b`, 'i');
      return regex.test(searchText);
    } else {
      return searchText.includes(searchTerm);
    }
  }

  /**
   * Find all matches of a sensitive term in text
   */
  private findMatches(
    text: string,
    termKey: string,
    config: SensitiveTermConfig,
  ): Array<{ term: string; index: number; length: number }> {
    const matches: Array<{ term: string; index: number; length: number }> = [];
    const searchText = config.caseSensitive ? text : text.toLowerCase();
    const searchTerm = config.caseSensitive ? config.term : termKey;

    if (config.wholeWordOnly) {
      const regex = new RegExp(`\\b${this.escapeRegex(searchTerm)}\\b`, config.caseSensitive ? 'g' : 'gi');
      let match;
      while ((match = regex.exec(searchText)) !== null) {
        matches.push({
          term: text.substring(match.index, match.index + match[0].length),
          index: match.index,
          length: match[0].length,
        });
      }
    } else {
      let startIndex = 0;
      while (true) {
        const index = config.caseSensitive
          ? searchText.indexOf(searchTerm, startIndex)
          : searchText.indexOf(searchTerm.toLowerCase(), startIndex);

        if (index === -1) break;

        matches.push({
          term: text.substring(index, index + searchTerm.length),
          index,
          length: searchTerm.length,
        });

        startIndex = index + searchTerm.length;
      }
    }

    return matches;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Create and export a default instance
export const defaultSensitiveTermsManager = new SensitiveTermsManager();

export default SensitiveTermsManager;
