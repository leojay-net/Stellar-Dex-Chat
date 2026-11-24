import { describe, it, expect } from 'vitest';
import { findFAQMatch } from '../faq';

describe('findFAQMatch', () => {
  it('matches exact FAQ questions', () => {
    expect(findFAQMatch('deposit xlm')).not.toBeNull();
    expect(findFAQMatch('is it safe')).not.toBeNull();
    expect(findFAQMatch('portfolio')).not.toBeNull();
  });

  it('avoids substring false positives', () => {
    expect(findFAQMatch('insecure')).toBeNull(); // "secure" is a FAQ
    expect(findFAQMatch('my portfolio123')).toBeNull();
  });

  it('matches when FAQ phrase is surrounded by boundaries', () => {
    expect(findFAQMatch('how do i deposit?')).not.toBeNull();
  });
});
