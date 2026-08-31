import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auditLog', () => ({
  default: {
    getAuditEntries: vi.fn(() => []),
  },
}));

const { GET } = await import('./route');

function request(query = '') {
  return new NextRequest(`http://localhost/api/admin-audit${query}`);
}

describe('GET /api/admin-audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with default pagination', async () => {
    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      entries: [],
      total: 0,
      limit: 100,
      offset: 0,
      hasMore: false,
    });
  });

  it('returns 400 for invalid startDate', async () => {
    const res = await GET(request('?startDate=not-a-date'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('startDate');
  });

  it('returns 400 for invalid endDate', async () => {
    const res = await GET(request('?endDate=zzz'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('endDate');
  });

  it('accepts valid ISO dates', async () => {
    const res = await GET(
      request('?startDate=2025-01-01T00:00:00Z&endDate=2025-12-31T23:59:59Z'),
    );
    expect(res.status).toBe(200);
  });

  it('clamps limit to max 1000', async () => {
    const res = await GET(request('?limit=9999'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limit).toBe(1000);
  });

  it('defaults limit to 100 for non-numeric input', async () => {
    const res = await GET(request('?limit=abc'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limit).toBe(100);
  });

  it('defaults offset to 0 for non-numeric input', async () => {
    const res = await GET(request('?offset=abc'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.offset).toBe(0);
  });

  it('returns 405 for POST', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    expect(res.status).toBe(405);
  });
});
