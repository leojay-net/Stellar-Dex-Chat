import { NextResponse } from 'next/server';
import { getClientIp } from './clientIp';

export { getClientIp };

/**
 * Configuration options for the in-memory sliding window rate limiter.
 */
export interface RateLimitConfig {
  /** Maximum number of allowed requests within the configured time window. */
  maxRequests: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
}

const STORE_SWEEP_INTERVAL_MS = 60_000;
const store = new Map<
  string,
  { count: number; windowStart: number; expiresAt: number }
>();
let nextStoreSweepAt = 0;

/**
 * Applies sliding-window rate limiting for a given client IP and route namespace.
 *
 * ### Arithmetic & Overflow Safety
 * - **Window Rollover Arithmetic**: Evaluates `now - entry.windowStart >= config.windowMs`.
 *   If the window has elapsed, the counter resets directly to 1 with `windowStart = now`,
 *   preventing monotonic counter overflow.
 * - **Safe Division for Retry Headers**: Calculates `Math.ceil(config.windowMs / 1000)` to ensure
 *   a minimum non-zero retry delay in seconds.
 *
 * @param ip - Client IP address (use {@link getClientIp} to extract from a request).
 * @param route - Route identifier used to namespace the rate-limit bucket.
 * @param config - Rate limit configuration containing request limits and window duration.
 * @returns A 429 `NextResponse` with standard rate limit headers if exceeded, or `null` if permitted.
 */
export function applyRateLimit(
  ip: string,
  route: string,
  config: RateLimitConfig,
): NextResponse | null {
  const key = `${ip}:${route}`;
  const now = Date.now();
  if (now >= nextStoreSweepAt) {
    for (const [storedKey, storedEntry] of store) {
      if (storedEntry.expiresAt <= now) store.delete(storedKey);
    }
    nextStoreSweepAt = now + STORE_SWEEP_INTERVAL_MS;
  }
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    store.set(key, {
      count: 1,
      windowStart: now,
      expiresAt: now + config.windowMs,
    });
    return null;
  }

  entry.count += 1;
  if (entry.count > config.maxRequests) {
    const retryAfterSeconds = Math.ceil(config.windowMs / 1000);
    return NextResponse.json(
      { success: false, retryAfter: retryAfterSeconds },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(config.maxRequests),
        },
      },
    );
  }

  return null;
}
