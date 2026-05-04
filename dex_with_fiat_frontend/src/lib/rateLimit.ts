import { NextRequest, NextResponse } from 'next/server';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// In-memory store: ip -> { count, windowStart }
const store = new Map<string, { count: number; windowStart: number }>();

/**
 * Extracts the client IP from a NextRequest.
 * Checks x-forwarded-for first, then x-real-ip, then falls back to 'unknown'.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return 'unknown';
}

/**
 * Applies rate limiting to a request.
 * Returns a 429 NextResponse if the limit is exceeded, otherwise null.
 */
export function applyRateLimit(
  req: NextRequest,
  config: RateLimitConfig,
): NextResponse | null {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    store.set(ip, { count: 1, windowStart: now });
    return null;
  }

  entry.count += 1;
  if (entry.count > config.maxRequests) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429 },
    );
  }

  return null;
}
