import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const applyRateLimitMock = vi.fn(() => null);

vi.mock('@/lib/rateLimit', () => ({
  applyRateLimit: (...args: unknown[]) => applyRateLimitMock(...args),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/telemetry', () => ({
  telemetry: {
    extractTraceFromHeaders: () => ({ traceId: 'trace', spanId: 'parent' }),
    createSpan: () => ({ spanId: 'span' }),
    addLog: vi.fn(),
    finishSpan: vi.fn(),
    setTraceHeaders: vi.fn(),
  },
}));

const createRecipientMock = vi.fn().mockResolvedValue({
  recipient_code: 'RCP_test',
  name: 'Ada Lovelace',
});

vi.mock('@/lib/payout/providers/registry', () => ({
  getPayoutProvider: () => ({ createRecipient: createRecipientMock }),
}));

const { POST } = await import('./route');

const VALID_BODY = {
  type: 'nuban',
  name: 'Ada Lovelace',
  account_number: '0123456789',
  bank_code: '058',
  currency: 'NGN',
};

function makeRequest(body: unknown, raw = false) {
  return new NextRequest(
    new Request('http://localhost/api/create-recipient', {
      method: 'POST',
      body: raw ? (body as string) : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('POST /api/create-recipient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyRateLimitMock.mockReturnValue(null);
    createRecipientMock.mockResolvedValue({
      recipient_code: 'RCP_test',
      name: 'Ada Lovelace',
    });
  });

  it('creates a recipient for a valid body', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(createRecipientMock).toHaveBeenCalledWith(
      expect.objectContaining({ bank_code: '058', currency: 'NGN' }),
    );
  });

  it('returns 400 with a machine-readable error shape for invalid input', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, name: '', account_number: '' }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validation failed');
    expect(Array.isArray(body.errors)).toBe(true);
    const paths = body.errors.flatMap((e: { path: string[] }) => e.path);
    expect(paths).toContain('name');
    expect(paths).toContain('account_number');
    expect(createRecipientMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await POST(makeRequest('not json{{{', true));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/invalid json/i);
    expect(createRecipientMock).not.toHaveBeenCalled();
  });

  it('returns 429 when the shared rate limiter rejects the request', async () => {
    applyRateLimitMock.mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, retryAfter: 60 }), {
        status: 429,
      }) as never,
    );

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(429);
    expect(createRecipientMock).not.toHaveBeenCalled();
  });

  it('namespaces the rate-limit bucket to this route', async () => {
    await POST(makeRequest(VALID_BODY));

    expect(applyRateLimitMock).toHaveBeenCalledWith(
      '127.0.0.1',
      '/api/create-recipient',
      expect.objectContaining({ maxRequests: expect.any(Number) }),
    );
  });
});
