import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const applyRateLimitMock = vi.fn(() => null);

vi.mock('@/lib/rateLimit', () => ({
  applyRateLimit: (...args: unknown[]) => applyRateLimitMock(...args),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

const subscribeToPaymentStatusMock = vi.fn(() => vi.fn());

vi.mock('@/lib/paymentStatusEvents', () => ({
  subscribeToPaymentStatus: (...args: unknown[]) =>
    subscribeToPaymentStatusMock(...args),
}));

const { GET } = await import('./route');

function makeRequest(query: string) {
  return new NextRequest(
    new Request(`http://localhost/api/payment-status/stream${query}`),
  );
}

describe('GET /api/payment-status/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyRateLimitMock.mockReturnValue(null);
    subscribeToPaymentStatusMock.mockReturnValue(vi.fn());
  });

  it('returns 400 with a machine-readable error shape when sessionId is missing', async () => {
    const res = await GET(makeRequest(''));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validation failed');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0].path).toEqual(['sessionId']);
    expect(subscribeToPaymentStatusMock).not.toHaveBeenCalled();
  });

  it('returns 400 when sessionId exceeds the maximum length', async () => {
    const res = await GET(makeRequest(`?sessionId=${'a'.repeat(201)}`));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(subscribeToPaymentStatusMock).not.toHaveBeenCalled();
  });

  it('opens an SSE stream for a valid sessionId', async () => {
    const res = await GET(makeRequest('?sessionId=session-abc'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(subscribeToPaymentStatusMock).toHaveBeenCalledWith(
      'session-abc',
      expect.any(Function),
    );

    // Tear down the stream so its heartbeat interval is cleared.
    await res.body?.cancel();
  });

  it('returns 429 when the rate limit is exceeded before any validation runs', async () => {
    applyRateLimitMock.mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, retryAfter: 60 }), {
        status: 429,
      }) as never,
    );

    const res = await GET(makeRequest('?sessionId=session-abc'));

    expect(res.status).toBe(429);
    expect(subscribeToPaymentStatusMock).not.toHaveBeenCalled();
  });
});
