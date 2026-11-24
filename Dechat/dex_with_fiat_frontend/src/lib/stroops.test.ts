import { describe, expect, it } from 'vitest';

import {
  StroopsFormatError,
  stroopsToDisplay,
  stroopsToXlm,
  stroopsToXlmOrNull,
  xlmToStroops,
} from './stroops';

describe('xlmToStroops', () => {
  it('scales whole and fractional XLM values by 10^7', () => {
    expect(xlmToStroops('1')).toBe(10_000_000n);
    expect(xlmToStroops('0.5')).toBe(5_000_000n);
    expect(xlmToStroops('100.5')).toBe(1_005_000_000n);
    expect(xlmToStroops(0)).toBe(0n);
    expect(xlmToStroops('0.0000001')).toBe(1n);
  });

  it('rejects sub-stroop precision, negatives, empty and malformed input', () => {
    expect(xlmToStroops('0.00000001')).toBeNull();
    expect(xlmToStroops('-5')).toBeNull();
    expect(xlmToStroops('')).toBeNull();
    expect(xlmToStroops('   ')).toBeNull();
    expect(xlmToStroops('1.2.3')).toBeNull();
    expect(xlmToStroops('abc')).toBeNull();
  });
});

describe('stroopsToXlm', () => {
  it('formats whole and fractional values without trailing zeros', () => {
    expect(stroopsToXlm(0n)).toBe('0');
    expect(stroopsToXlm(1n)).toBe('0.0000001');
    expect(stroopsToXlm(10_000_000n)).toBe('1');
    expect(stroopsToXlm(1_005_000_000n)).toBe('100.5');
    expect(stroopsToXlm('50000000')).toBe('5');
  });

  it('puts the sign in front of the whole part for negative values', () => {
    // Before the fix the sign stayed inside the fractional slot: -5n rendered
    // as "0.00000-5" and -15_000_000n as "-1.-5".
    expect(stroopsToXlm(-1n)).toBe('-0.0000001');
    expect(stroopsToXlm(-5n)).toBe('-0.0000005');
    expect(stroopsToXlm(-5_000_000n)).toBe('-0.5');
    expect(stroopsToXlm(-10_000_000n)).toBe('-1');
    expect(stroopsToXlm(-10_050_000n)).toBe('-1.005');
    expect(stroopsToXlm('-12345678')).toBe('-1.2345678');
  });

  it('does not introduce a negative zero', () => {
    expect(stroopsToXlm(-0n)).toBe('0');
  });

  it('formats values beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const beyondSafeInteger = 90_071_992_547_409_100n;

    expect(stroopsToXlm(beyondSafeInteger)).toBe('9007199254.74091');
    expect(stroopsToXlm(-beyondSafeInteger)).toBe('-9007199254.74091');
  });

  it('round-trips values through xlmToStroops and back', () => {
    for (const value of ['1', '0.0000001', '100.5', '12345.6789012']) {
      const stroops = xlmToStroops(value);

      expect(stroops).not.toBeNull();
      expect(stroopsToXlm(stroops as bigint)).toBe(value);
    }
  });

  it('accepts a leading plus sign and surrounding whitespace', () => {
    expect(stroopsToXlm('+10000000')).toBe('1');
    expect(stroopsToXlm(' 10000000 ')).toBe('1');
    expect(stroopsToXlm(' -5000000 ')).toBe('-0.5');
  });

  it('throws a typed error for input that is not a base-10 integer', () => {
    for (const invalid of ['1.5', '', '   ', 'abc', '1e7', '0x10', '10,000']) {
      expect(() => stroopsToXlm(invalid)).toThrow(StroopsFormatError);
    }
  });

  it('reports the offending value on the thrown error', () => {
    expect.assertions(2);

    try {
      stroopsToXlm('1.5');
    } catch (error) {
      expect(error).toBeInstanceOf(StroopsFormatError);
      expect((error as StroopsFormatError).value).toBe('1.5');
    }
  });
});

describe('stroopsToXlmOrNull', () => {
  it('formats valid input exactly like stroopsToXlm', () => {
    expect(stroopsToXlmOrNull(10_000_000n)).toBe('1');
    expect(stroopsToXlmOrNull('-5000')).toBe('-0.0005');
  });

  it('returns null instead of throwing so display paths keep rendering', () => {
    expect(stroopsToXlmOrNull('1.5')).toBeNull();
    expect(stroopsToXlmOrNull('')).toBeNull();
    expect(stroopsToXlmOrNull('not-a-number')).toBeNull();
  });
});

describe('stroopsToDisplay', () => {
  it('remains an alias of stroopsToXlm', () => {
    expect(stroopsToDisplay).toBe(stroopsToXlm);
  });
});
