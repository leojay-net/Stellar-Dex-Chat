import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const mockSchema = z.object({
  source: z.string().min(1),
  reason: z.string().min(1),
  amount: z.string().min(1),
  recipient: z.string().min(1),
  reference: z.string().optional(),
});

vi.mock('@/lib/telemetry', () => ({
  telemetry: {
    extractTraceFromHeaders: () => ({ traceId: 'trace', spanId: 'parent' }),
    createSpan: () => ({ spanId: 'span' }),
    addLog: vi.fn(),
    finishSpan: vi.fn(),
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/transferStore', () => ({
  setTransferStatus: vi.fn(),
}));

vi.mock('@/lib/payout/providers/registry', () => ({
  getPayoutProvider: () => ({
    initiateTransfer: vi.fn().mockResolvedValue({ reference: 'ref-123' }),
  }),
}));

vi.mock('@/lib/apiSchemas', () => ({
  initiateTransferSchema: mockSchema,
}));

const { POST } = await import('./route');

let keyCounter = 0;
// The route requires X-Idempotency-Key and caches results per key, so each
// request gets a fresh key unless a test passes one explicitly.
function makeRequest(
  body: unknown,
  idempotencyKey = `test-key-${++keyCounter}`,
) {
  return new NextRequest(
    new Request('http://localhost/api/initiate-transfer', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
    }),
  );
}

describe('POST /api/initiate-transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const badReq = new NextRequest(
      new Request('http://localhost/api/initiate-transfer', {
        method: 'POST',
        body: 'not json{{{',
        headers: {
          'content-type': 'application/json',
          'X-Idempotency-Key': `test-key-${++keyCounter}`,
        },
      }),
    );

    const res = await POST(badReq);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Invalid JSON');
  });

  it('returns 400 when the X-Idempotency-Key header is missing', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/initiate-transfer', {
        method: 'POST',
        body: JSON.stringify({
          source: 'wallet',
          reason: 'payment',
          amount: '100',
          recipient: 'GABC123',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.message).toContain('X-Idempotency-Key');
  });

  it('returns 400 for validation failures', async () => {
    const req = makeRequest({
      source: '',
      reason: '',
      amount: '',
      recipient: '',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validation failed');
  });

  it('returns 200 for valid request', async () => {
    const req = makeRequest({
      source: 'wallet',
      reason: 'payment',
      amount: '100',
      recipient: 'GABC123',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('replays the cached result for a repeated idempotency key', async () => {
    const payload = {
      source: 'wallet',
      reason: 'payment',
      amount: '100',
      recipient: 'GABC123',
    };
    const first = await POST(makeRequest(payload, 'replay-key'));
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await POST(makeRequest(payload, 'replay-key'));
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
  });
});
