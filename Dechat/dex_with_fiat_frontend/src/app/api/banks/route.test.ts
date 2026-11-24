import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/telemetry', () => ({
  telemetry: {
    extractTraceFromHeaders: () => ({ traceId: 'trace', spanId: 'parent' }),
    createSpan: () => ({ spanId: 'span' }),
    addLog: vi.fn(),
    finishSpan: vi.fn(),
    setTraceHeaders: vi.fn(),
  },
}));

const { GET } = await import('./route');

function request(query = '', ip = '198.51.100.100') {
  return new NextRequest(`http://localhost/api/banks${query}`, {
    headers: { 'cf-connecting-ip': ip },
  });
}

describe('GET /api/banks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a machine-readable 400 response for unsupported query parameters', async () => {
    const response = await GET(request('?country=ghana'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('rejects requests after the shared rate-limit quota is exhausted', async () => {
    const ip = '198.51.100.101';

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await GET(request('', ip))).status).toBe(200);
    }

    const response = await GET(request('', ip));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ success: false });
    expect(response.headers.get('Retry-After')).toBe('60');
  });
});
