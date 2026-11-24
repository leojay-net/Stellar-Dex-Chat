import { describe, expect, it } from 'vitest';
import { toKobo } from './paystackProvider';

describe('toKobo', () => {
  it('rounds fractional kobo explicitly', () => {
    expect(toKobo(1234.565)).toBe(123457);
  });

  it('corrects common floating-point representation artifacts', () => {
    expect(toKobo(0.1 + 0.2)).toBe(30);
  });

  it('keeps the maximum accepted transfer amount within safe integer range', () => {
    expect(toKobo(10_000_000)).toBe(1_000_000_000);
  });
});
