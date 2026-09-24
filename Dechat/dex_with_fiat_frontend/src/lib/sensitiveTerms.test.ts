import { describe, expect, it } from 'vitest';

import SensitiveTermsManager, {
  defaultSensitiveTermsManager,
} from './sensitiveTerms';
import type { SensitiveTermConfig } from './sensitiveTerms';

describe('SensitiveTermsManager defaults', () => {
  it('ships the built-in term list', () => {
    const terms = defaultSensitiveTermsManager.getTerms().map((t) => t.term);

    expect(terms).toContain('damn');
    expect(terms).toContain('idiot');
    expect(terms).toContain('hate');
  });

  it('flags text containing a default term', () => {
    const manager = new SensitiveTermsManager();

    expect(manager.isSensitive('what the hell is this')).toBe(true);
    expect(manager.isSensitive('have a nice day')).toBe(false);
  });
});

describe('case sensitivity', () => {
  const caseSensitiveTerm: SensitiveTermConfig = {
    term: 'Secret',
    category: 'custom',
    caseSensitive: true,
    wholeWordOnly: true,
  };

  it('matches regardless of case when caseSensitive is off', () => {
    const manager = new SensitiveTermsManager([
      {
        term: 'secret',
        category: 'custom',
        caseSensitive: false,
        wholeWordOnly: true,
      },
    ]);

    expect(manager.isSensitive('hush hush SECRET')).toBe(true);
    expect(manager.isSensitive('secret')).toBe(true);
  });

  it('honours caseSensitive for whole-word terms', () => {
    const manager = new SensitiveTermsManager([caseSensitiveTerm]);

    expect(manager.isSensitive('the Secret is out')).toBe(true);
    expect(manager.isSensitive('the secret is out')).toBe(false);
    expect(manager.isSensitive('SECRET')).toBe(false);
  });

  it('keeps isSensitive consistent with findSensitiveTerms when caseSensitive', () => {
    // Both entry points used to disagree here: matchesTerm hard-coded the 'i'
    // flag, so isSensitive said true while findSensitiveTerms found nothing.
    const manager = new SensitiveTermsManager([caseSensitiveTerm]);

    for (const text of [
      'the Secret is out',
      'the secret is out',
      'SECRET',
      'Secret',
    ]) {
      expect(manager.isSensitive(text)).toBe(
        manager.findSensitiveTerms(text).length > 0,
      );
    }
  });
});

describe('whole-word versus substring matching', () => {
  it('only matches a whole word when wholeWordOnly is set', () => {
    const manager = new SensitiveTermsManager([
      {
        term: 'rag',
        category: 'custom',
        caseSensitive: false,
        wholeWordOnly: true,
      },
    ]);

    expect(manager.isSensitive('rag')).toBe(true);
    expect(manager.isSensitive('storage')).toBe(false);
  });

  it('matches inside larger words when wholeWordOnly is off', () => {
    const manager = new SensitiveTermsManager([
      {
        term: 'rag',
        category: 'custom',
        caseSensitive: false,
        wholeWordOnly: false,
      },
    ]);

    expect(manager.isSensitive('storage')).toBe(true);
  });
});

describe('regex special characters in terms', () => {
  it('treats term characters literally', () => {
    const manager = new SensitiveTermsManager([
      {
        term: 'a.b',
        category: 'custom',
        caseSensitive: false,
        wholeWordOnly: true,
      },
      {
        term: 'c++',
        category: 'custom',
        caseSensitive: false,
        wholeWordOnly: false,
      },
    ]);

    expect(manager.isSensitive('a.b')).toBe(true);
    expect(manager.isSensitive('axb')).toBe(false);
    expect(manager.isSensitive('i code in c++')).toBe(true);
  });
});

describe('addTerms and removeTerm', () => {
  it('adds custom terms', () => {
    const manager = new SensitiveTermsManager();

    expect(manager.isSensitive('foobar')).toBe(false);
    manager.addTerms([
      {
        term: 'foobar',
        category: 'custom',
        caseSensitive: false,
        wholeWordOnly: true,
      },
    ]);
    expect(manager.isSensitive('foobar')).toBe(true);
  });

  it('removes a term case-insensitively by default', () => {
    const manager = new SensitiveTermsManager();

    expect(manager.isSensitive('damn')).toBe(true);
    manager.removeTerm('DAMN');
    expect(manager.isSensitive('damn')).toBe(false);
  });

  it('exposes the current term list', () => {
    const manager = new SensitiveTermsManager([]);

    expect(manager.getTerms()).toHaveLength(11);
    manager.addTerms([{ term: 'extra', category: 'custom' }]);
    expect(manager.getTerms().map((t) => t.term)).toContain('extra');
  });
});

describe('findSensitiveTerms', () => {
  it('reports matches sorted by index, including overlapping terms', () => {
    const manager = new SensitiveTermsManager([
      { term: 'foo', category: 'custom', wholeWordOnly: false },
      { term: 'foobar', category: 'custom', wholeWordOnly: false },
    ]);

    const matches = manager.findSensitiveTerms('a foobar b');

    expect(matches.map((m) => m.term)).toEqual(['foo', 'foobar']);
    expect(matches.map((m) => m.index)).toEqual([2, 2]);
    expect(matches.map((m) => m.length)).toEqual([3, 6]);
  });

  it('reports every occurrence of a term', () => {
    const manager = new SensitiveTermsManager([
      { term: 'foo', category: 'custom', wholeWordOnly: false },
    ]);

    const matches = manager.findSensitiveTerms('foo foo');

    expect(matches.map((m) => m.index)).toEqual([0, 4]);
  });

  it('stays consistent with isSensitive across sample text', () => {
    const manager = new SensitiveTermsManager();
    const samples = [
      'you are an idiot',
      'have a nice day',
      'what the hell',
      'HELL',
      'classic',
      '',
    ];

    for (const text of samples) {
      expect(manager.isSensitive(text)).toBe(
        manager.findSensitiveTerms(text).length > 0,
      );
    }
  });

  it('returns an empty list for an empty string', () => {
    expect(new SensitiveTermsManager().findSensitiveTerms('')).toEqual([]);
  });
});
