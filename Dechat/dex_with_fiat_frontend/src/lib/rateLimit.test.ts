import { NextRequest } from 'next/server';
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
import { getClientIp, applyRateLimit, type RateLimitConfig } from './rateLimit';

describe('rateLimit utility', () => {
  beforeAll(() => {
    // Suppress console.warn during tests to keep the test output clean
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('getClientIp', () => {
    it('should use the platform client IP before forwarded headers', () => {
      const req = new NextRequest('http://localhost', {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '70.41.3.18, 198.51.100.1',
        },
      });
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('should select the client before the configured trusted XFF hops', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      const req = new NextRequest('http://localhost', {
        headers: { 'x-forwarded-for': ' 10.0.0.1 , 192.168.1.1' },
      });
      expect(getClientIp(req)).toBe('10.0.0.1');
      vi.unstubAllEnvs();
    });

    it('should fall back to x-real-ip if x-forwarded-for is not present', () => {
      const req = new NextRequest('http://localhost', {
        headers: { 'x-real-ip': '198.51.100.1' },
      });
      expect(getClientIp(req)).toBe('198.51.100.1');
    });

    it('should return "unknown" if no IP headers are found', () => {
      const req = new NextRequest('http://localhost');
      expect(getClientIp(req)).toBe('unknown');
    });

    it('ignores spoofed XFF values when no proxy hops are trusted', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '0');
      const first = new NextRequest('http://localhost', {
        headers: { 'x-forwarded-for': '198.51.100.101' },
      });
      const second = new NextRequest('http://localhost', {
        headers: { 'x-forwarded-for': '198.51.100.202' },
      });

      const config = { maxRequests: 1, windowMs: 60_000 };
      const firstResult = applyRateLimit(
        getClientIp(first),
        'rotating-spoof-test',
        config,
      );
      const secondResult = applyRateLimit(
        getClientIp(second),
        'rotating-spoof-test',
        config,
      );

      expect(firstResult).toBeNull();
      expect(secondResult?.status).toBe(429);
      vi.unstubAllEnvs();
    });
  });

  describe('applyRateLimit', () => {
    const config: RateLimitConfig = {
      maxRequests: 2,
      windowMs: 5000, // 5 seconds
    };

    beforeEach(() => {
      vi.useFakeTimers();
      // Use a fixed starting time for deterministic behavior
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should allow the first N requests within the window', () => {
      // Using unique IP and route to avoid interference between tests
      const ip = '10.0.0.1';
      const route = 'test-route-allow';

      expect(applyRateLimit(ip, route, config)).toBeNull();
      expect(applyRateLimit(ip, route, config)).toBeNull();
    });

    it('should return a 429 response when requests exceed the limit', async () => {
      const ip = '10.0.0.2';
      const route = 'test-route-block';

      // Consume the quota (maxRequests: 2)
      applyRateLimit(ip, route, config);
      applyRateLimit(ip, route, config);

      // Third request should be blocked
      const response = applyRateLimit(ip, route, config);
      expect(response).not.toBeNull();
      expect(response?.status).toBe(429);

      const body = await response?.json();
      expect(body.success).toBe(false);
      expect(body.retryAfter).toBe(5); // 5 seconds window

      // Verify standard rate limit headers
      expect(response?.headers.get('Retry-After')).toBe('5');
      expect(response?.headers.get('X-RateLimit-Limit')).toBe('2');
    });

    it('should reset the limit once the window has expired', () => {
      const ip = '10.0.0.3';
      const route = 'test-route-reset';

      applyRateLimit(ip, route, config);
      applyRateLimit(ip, route, config);
      expect(applyRateLimit(ip, route, config)).not.toBeNull(); // Blocked

      // Advance time by slightly more than windowMs
      vi.advanceTimersByTime(config.windowMs + 1);

      expect(applyRateLimit(ip, route, config)).toBeNull(); // Allowed again
    });
  });
});
