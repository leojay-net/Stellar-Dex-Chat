import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const applyRateLimitMock = vi.fn(() => null);

vi.mock('@/lib/rateLimit', () => ({
  applyRateLimit: (...args: unknown[]) => applyRateLimitMock(...args),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/payout/providers/registry', () => ({
  getPayoutProvider: () => ({
    checkTransferStatus: vi.fn().mockResolvedValue({ reference: 'ref-123', status: 'success' }),
  }),
}));

const { POST } = await import('./route');

function makeRequest(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/transfer-status', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('POST /api/transfer-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyRateLimitMock.mockReturnValue(null);
  });

  it('returns 400 for malformed JSON body', async () => {
    const badReq = new NextRequest(
      new Request('http://localhost/api/transfer-status', {
        method: 'POST',
        body: 'not json{{{',
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await POST(badReq);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('returns 400 for validation failures', async () => {
    const req = makeRequest({ reference: '' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('returns 200 for a valid request', async () => {
    const req = makeRequest({ reference: 'ref-123' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    applyRateLimitMock.mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, retryAfter: 60 }), {
        status: 429,
      }) as never,
    );

    const req = makeRequest({ reference: 'ref-123' });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });
});
