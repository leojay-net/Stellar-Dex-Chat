import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const applyRateLimitMock = vi.fn(() => null);

vi.mock('@/lib/rateLimit', () => ({
  applyRateLimit: (...args: unknown[]) => applyRateLimitMock(...args),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
  },
}));

const { GET } = await import('./route');

function makeRequest(query: string) {
  return new NextRequest(new Request(`http://localhost/api/events${query}`));
}

describe('GET /api/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyRateLimitMock.mockReturnValue(null);
  });

  it('returns 400 for a non-numeric limit', async () => {
    const req = makeRequest('?limit=not-a-number');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('returns 400 for a negative offset', async () => {
    const req = makeRequest('?offset=-1');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('returns 400 when limit exceeds the maximum', async () => {
    const req = makeRequest('?limit=1000');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('defaults limit and offset when omitted', async () => {
    const req = makeRequest('');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    applyRateLimitMock.mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, retryAfter: 60 }), {
        status: 429,
      }) as never,
    );

    const req = makeRequest('');
    const res = await GET(req);

    expect(res.status).toBe(429);
  });
});
