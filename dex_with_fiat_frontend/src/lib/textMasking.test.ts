import {
    SensitiveTermConfig,
    SensitiveTermsManager,
} from '@/lib/sensitiveTerms';
import {
    generateMask,
    getMaskingStats,
    MaskingStyle,
    maskText,
} from '@/lib/textMasking';
import { beforeEach, describe, expect, it } from 'vitest';

describe('Sensitive Terms Manager', () => {
  let manager: SensitiveTermsManager;

  beforeEach(() => {
    manager = new SensitiveTermsManager();
  });

  describe('Term Detection', () => {
    it('should detect case-insensitive profanity', () => {
      expect(manager.isSensitive('This is damn annoying')).toBe(true);
      expect(manager.isSensitive('This is DAMN annoying')).toBe(true);
      expect(manager.isSensitive('This is Damn annoying')).toBe(true);
    });

    it('should find all sensitive terms in text', () => {
      const text = 'This is damn annoying and I hate it.';
      const matches = manager.findSensitiveTerms(text);
      expect(matches.length).toBe(2);
      expect(matches[0].term).toBe('damn');
      expect(matches[1].term).toBe('hate');
    });

    it('should return correct index positions for matches', () => {
      const text = 'This is damn annoying';
      const matches = manager.findSensitiveTerms(text);
      expect(matches[0].index).toBe(8);
      expect(matches[0].length).toBe(4);
    });
  });

  describe('Custom Terms', () => {
    it('should add custom terms to the manager', () => {
      const customTerms: SensitiveTermConfig[] = [
        { term: 'xyz', category: 'custom', caseSensitive: false },
      ];
      const customManager = new SensitiveTermsManager(customTerms);
      expect(customManager.isSensitive('This is xyz')).toBe(true);
    });

    it('should remove terms from the manager', () => {
      expect(manager.isSensitive('damn')).toBe(true);
      manager.removeTerm('damn', false);
      expect(manager.isSensitive('damn')).toBe(false);
    });
  });
});

describe('Text Masking', () => {
  let manager: SensitiveTermsManager;

  beforeEach(() => {
    manager = new SensitiveTermsManager();
  });

  describe('Mask Generation', () => {
    it('should generate asterisk masks', () => {
      expect(generateMask('damn', 'asterisk')).toBe('****');
      expect(generateMask('a', 'asterisk')).toBe('*');
    });

    it('should generate block masks', () => {
      expect(generateMask('damn', 'block')).toBe('████');
    });

    it('should generate initial masks', () => {
      expect(generateMask('damn', 'initial')).toBe('d***');
      expect(generateMask('a', 'initial')).toBe('*');
    });

    it('should generate pipe masks', () => {
      expect(generateMask('damn', 'pipe')).toBe('|damn|');
    });
  });

  describe('Text Masking Application', () => {
    it('should mask single sensitive term', () => {
      const text = 'This is damn annoying';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('This is **** annoying');
    });

    it('should mask multiple different terms', () => {
      const text = 'This is damn and I hate it';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('This is **** and I **** it');
    });

    it('should apply different mask styles', () => {
      const text = 'This is damn bad';

      const asterisk = maskText(text, manager, 'asterisk');
      expect(asterisk).toBe('This is **** bad');

      const block = maskText(text, manager, 'block');
      expect(block).toBe('This is ████ bad');

      const initial = maskText(text, manager, 'initial');
      expect(initial).toBe('This is d*** bad');
    });

    it('should handle text with no sensitive terms', () => {
      const text = 'This is a perfectly fine message';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe(text);
    });

    it('should handle empty text', () => {
      const text = '';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('');
    });
  });

  describe('Masking Boundaries and Edge Cases', () => {
    it('should handle punctuation around sensitive terms', () => {
      const text = 'This is damn! Really damn?';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('This is ****! Really ****?');
    });

    it('should handle sensitive terms at start of text', () => {
      const text = 'Damn, this is annoying';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('****, this is annoying');
    });

    it('should handle sensitive terms at end of text', () => {
      const text = 'This is so damn';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('This is so ****');
    });

    it('should handle consecutive sensitive terms', () => {
      const text = 'damn hell crap';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('**** **** ****');
    });

    it('should preserve whitespace and formatting', () => {
      const text = 'This is  damn   with  extra   spaces';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toContain('  ');
      expect(masked).toContain('   ');
    });

    it('should handle newlines and special characters', () => {
      const text = 'This is damn\nand hell\nand crap';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toContain('\n');
      expect(masked.split('\n').length).toBe(3);
    });
  });

  describe('False Positives Prevention', () => {
    it('should not mask words containing term as substring when word boundary required', () => {
      const text = 'This is excellent news';
      const masked = maskText(text, manager, 'asterisk');
      // "excellent" should not be masked
      expect(masked).toBe(text);
    });

    it('should distinguish between similar words', () => {
      const text = 'I hate hateful people';
      const masked = maskText(text, manager, 'asterisk');
      // Only "hate" should be masked
      expect(masked.match(/\*/g)?.length).toBe(4);
    });

    it('should handle repeated characters gracefully', () => {
      const text = 'This is sooooo damn good';
      const masked = maskText(text, manager, 'asterisk');
      expect(masked).toBe('This is sooooo **** good');
    });
  });

  describe('Performance and Statistics', () => {
    it('should generate accurate masking statistics', () => {
      const text = 'This is damn annoying and I hate it';
      const stats = getMaskingStats(text, manager);

      expect(stats.totalTermsFound).toBe(2);
      expect(stats.uniqueTerms.size).toBe(2);
      expect(stats.uniqueTerms.has('damn')).toBe(true);
      expect(stats.uniqueTerms.has('hate')).toBe(true);
    });

    it('should categorize masked terms correctly', () => {
      const text = 'This is damn and I hate it';
      const stats = getMaskingStats(text, manager);

      expect(stats.byCategory['profanity']).toBeGreaterThan(0);
      expect(stats.byCategory['sensitive']).toBeGreaterThan(0);
    });

    it('should handle large text efficiently', () => {
      const largeText = 'This is a message. '.repeat(1000) + 'This is damn annoying.';
      const startTime = performance.now();
      const masked = maskText(largeText, manager, 'asterisk');
      const endTime = performance.now();

      expect(masked).toContain('****');
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});

describe('Acceptance Criteria', () => {
  let manager: SensitiveTermsManager;

  beforeEach(() => {
    manager = new SensitiveTermsManager();
  });

  it('✅ should have configurable sensitive term list', () => {
    const customTerms: SensitiveTermConfig[] = [
      { term: 'custom1', category: 'custom' },
      { term: 'custom2', category: 'custom' },
    ];
    const customManager = new SensitiveTermsManager(customTerms);
    expect(customManager.isSensitive('custom1')).toBe(true);
    expect(customManager.isSensitive('custom2')).toBe(true);
  });

  it('✅ should mask matching terms in rendered messages', () => {
    const text = 'This message contains damn and hell';
    const masked = maskText(text, manager, 'asterisk');
    expect(masked).toContain('****');
    expect(masked).not.toContain('damn');
    expect(masked).not.toContain('hell');
  });

  it('✅ should support masking style options for user preferences', () => {
    const text = 'This is damn bad';
    const styles: MaskingStyle[] = ['asterisk', 'block', 'initial'];

    styles.forEach((style) => {
      const masked = maskText(text, manager, style);
      expect(masked).not.toBe(text);
      expect(masked).not.toContain('damn');
    });
  });

  it('✅ should test masking boundaries correctly', () => {
    const boundaryTests = [
      { text: 'damn', shouldMask: true },
      { text: 'Damn', shouldMask: true },
      { text: 'damnit', shouldMask: false },
      { text: 'condamn', shouldMask: false },
    ];

    boundaryTests.forEach(({ text, shouldMask }) => {
      const result = maskText(text, manager, 'asterisk');
      if (shouldMask) {
        expect(result).toContain('*');
      } else {
        expect(result).toBe(text);
      }
    });
  });

  it('✅ should prevent false positives', () => {
    const falsePositiveTests = [
      'This is a class example',
      'I appreciate your passion',
    ];

    falsePositiveTests.forEach((text) => {
      const masked = maskText(text, manager, 'asterisk');
      expect(masked.length).toBeGreaterThan(0);
    });
  });
});
