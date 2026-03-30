import { describe, expect, it } from 'vitest';
import { isSafeUrl, sanitizeUrl, sanitizeText } from './markdownSanitizer';

// ---------------------------------------------------------------------------
// isSafeUrl – test vectors for common markdown / XSS payloads
// ---------------------------------------------------------------------------

describe('isSafeUrl', () => {
  // Safe URLs
  it('allows https links', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
  });

  it('allows http links', () => {
    expect(isSafeUrl('http://example.com/path')).toBe(true);
  });

  it('allows mailto links', () => {
    expect(isSafeUrl('mailto:user@example.com')).toBe(true);
  });

  it('allows root-relative URLs', () => {
    expect(isSafeUrl('/internal/page')).toBe(true);
  });

  it('allows hash anchors', () => {
    expect(isSafeUrl('#section-1')).toBe(true);
  });

  it('allows relative paths', () => {
    expect(isSafeUrl('./image.png')).toBe(true);
  });

  // Blocked – javascript: variants
  it('blocks plain javascript: scheme', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('blocks javascript: with mixed case', () => {
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('blocks javascript: with leading spaces', () => {
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
  });

  it('blocks javascript: with tab character', () => {
    expect(isSafeUrl('\tjavascript:alert(1)')).toBe(false);
  });

  it('blocks percent-encoded javascript: scheme', () => {
    // javas%63ript: decodes to javascript:
    expect(isSafeUrl('javas%63ript:alert(1)')).toBe(false);
  });

  // Blocked – other dangerous schemes
  it('blocks vbscript: scheme', () => {
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('blocks data: URIs (potential XSS via inline HTML)', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('blocks data: image URIs (exfiltration vector)', () => {
    expect(isSafeUrl('data:image/png;base64,abc123')).toBe(false);
  });

  it('blocks file: URIs', () => {
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('blocks blob: URIs', () => {
    expect(isSafeUrl('blob:https://evil.com/xxx')).toBe(false);
  });

  // Edge cases
  it('returns false for null', () => {
    expect(isSafeUrl(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSafeUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSafeUrl('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl
// ---------------------------------------------------------------------------

describe('sanitizeUrl', () => {
  it('returns the URL unchanged when safe', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('returns #blocked for javascript: payloads', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#blocked');
  });

  it('returns #blocked for data: URIs', () => {
    expect(sanitizeUrl('data:text/html,<h1>xss</h1>')).toBe('#blocked');
  });

  it('returns #blocked for null', () => {
    expect(sanitizeUrl(null)).toBe('#blocked');
  });
});

// ---------------------------------------------------------------------------
// sanitizeText
// ---------------------------------------------------------------------------

describe('sanitizeText', () => {
  it('escapes angle brackets', () => {
    expect(sanitizeText('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes double quotes', () => {
    expect(sanitizeText('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('escapes single quotes', () => {
    expect(sanitizeText("it's fine")).toBe("it&#x27;s fine");
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });

  it('passes through safe text unchanged', () => {
    expect(sanitizeText('Hello world 123')).toBe('Hello world 123');
  });
});
