/**
 * Markdown sanitization utilities for assistant output.
 *
 * Allowed markdown subset:
 *   - Paragraphs, line breaks
 *   - Bold (**text**), italic (*text*)
 *   - Unordered lists (- item)
 *   - Inline code (`code`)
 *   - Headings h1-h3
 *   - Links with safe href schemes: https, http, mailto
 *   - Images with safe src schemes: https, http
 *
 * Blocked:
 *   - javascript: / vbscript: / data: URLs in href or src
 *   - Raw HTML passthrough (react-markdown default: disabled)
 */

/** URL schemes that are safe to render in links and images. */
const SAFE_URL_SCHEMES = ['https:', 'http:', 'mailto:'];

/**
 * Returns `true` when the given URL uses a safe scheme, `false` otherwise.
 * Relative URLs (no scheme) are allowed.
 */
export function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false;

  const trimmed = url.trim();

  // Relative URLs are fine
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.')) {
    return true;
  }

  try {
    // Decode percent-encoded characters to catch `javas%63ript:` etc.
    const decoded = decodeURIComponent(trimmed);
    const lower = decoded.toLowerCase().replace(/\s/g, '');

    // Reject common injection schemes
    if (
      lower.startsWith('javascript:') ||
      lower.startsWith('vbscript:') ||
      lower.startsWith('data:') ||
      lower.startsWith('file:') ||
      lower.startsWith('blob:')
    ) {
      return false;
    }
  } catch {
    // decodeURIComponent failed → treat as unsafe
    return false;
  }

  // Check against allowlist using the URL API
  try {
    const parsed = new URL(trimmed);
    return SAFE_URL_SCHEMES.includes(parsed.protocol);
  } catch {
    // Parsing failed – could be a relative URL not caught above; allow
    return true;
  }
}

/**
 * Returns the URL unchanged if safe, otherwise returns '#blocked'.
 */
export function sanitizeUrl(url: string | undefined | null): string {
  return isSafeUrl(url) ? (url as string) : '#blocked';
}

/**
 * Strips characters commonly used in XSS payloads from plain text content.
 * react-markdown text nodes are already safe, but this can be used for
 * attribute values where extra caution is warranted.
 */
export function sanitizeText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
