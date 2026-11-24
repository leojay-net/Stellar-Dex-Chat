import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import AuditLogService from '@/lib/auditLog';
import type { AuditEntry } from '@/types';

const mockEnv = { ADMIN_SECRET: 'test-admin-secret' };
vi.mock('@/lib/serverEnv', () => ({
  get serverEnv() {
    return mockEnv;
  },
}));

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
    mockEnv.ADMIN_SECRET = 'test-admin-secret';
  });

  it('returns 401 without authentication and does not read audit entries', async () => {
    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(AuditLogService.getAuditEntries).not.toHaveBeenCalled();
  });

  it('returns 401 with an invalid admin token', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/admin-audit', {
        headers: { 'x-admin-token': 'wrong-secret' },
      }),
    );

    expect(res.status).toBe(401);
    expect(AuditLogService.getAuditEntries).not.toHaveBeenCalled();
  });

  it('returns 200 with a valid admin token and default pagination', async () => {
    const res = await GET(authenticatedRequest());
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

  it('does not expose internal errors in the 500 response', async () => {
    vi.mocked(AuditLogService.getAuditEntries).mockImplementationOnce(() => {
      throw new Error('sensitive internal detail');
    });

    const res = await GET(authenticatedRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to retrieve audit entries' });
  });

  it('returns 400 for invalid startDate', async () => {
    const res = await GET(authenticatedRequest('?startDate=not-a-date'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('startDate');
  });

  it('returns 400 for invalid endDate', async () => {
    const res = await GET(authenticatedRequest('?endDate=zzz'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('endDate');
  });

  it('accepts valid ISO dates', async () => {
    const res = await GET(
      authenticatedRequest(
        '?startDate=2025-01-01T00:00:00Z&endDate=2025-12-31T23:59:59Z',
      ),
    );
    expect(res.status).toBe(200);
  });

  it('clamps limit to max 1000', async () => {
    const res = await GET(authenticatedRequest('?limit=9999'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limit).toBe(1000);
  });

  it('defaults limit to 100 for non-numeric input', async () => {
    const res = await GET(authenticatedRequest('?limit=abc'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.limit).toBe(100);
  });

  it('defaults offset to 0 for non-numeric input', async () => {
    const res = await GET(authenticatedRequest('?offset=abc'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.offset).toBe(0);
  });

  it('returns 400 for invalid sortKey', async () => {
    const res = await GET(authenticatedRequest('?sortKey=invalid'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('sortKey');
  });

  it('returns 400 for invalid sortOrder', async () => {
    const res = await GET(authenticatedRequest('?sortOrder=invalid'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('sortOrder');
  });

  it('sorts before pagination and pages are globally ordered', async () => {
    const mockEntries: AuditEntry[] = [
      {
        id: '1',
        timestamp: new Date('2025-01-03T00:00:00Z'),
        actionType: 'deposit',
        status: 'success',
        adminAddress: 'addr1',
        actionDescription: '',
        metadata: {},
      },
      {
        id: '2',
        timestamp: new Date('2025-01-01T00:00:00Z'),
        actionType: 'payout',
        status: 'failed',
        adminAddress: 'addr2',
        actionDescription: '',
        metadata: {},
      },
      {
        id: '3',
        timestamp: new Date('2025-01-02T00:00:00Z'),
        actionType: 'reconciliation',
        status: 'pending',
        adminAddress: 'addr3',
        actionDescription: '',
        metadata: {},
      },
      {
        id: '4',
        timestamp: new Date('2025-01-04T00:00:00Z'),
        actionType: 'deposit',
        status: 'success',
        adminAddress: 'addr4',
        actionDescription: '',
        metadata: {},
      },
      {
        id: '5',
        timestamp: new Date('2025-01-05T00:00:00Z'),
        actionType: 'payout',
        status: 'failed',
        adminAddress: 'addr5',
        actionDescription: '',
        metadata: {},
      },
    ];

    vi.mocked(AuditLogService.getAuditEntries).mockReturnValue(mockEntries);

    // Page 1 with limit 2
    const res1 = await GET(
      authenticatedRequest('?limit=2&offset=0&sortKey=timestamp&sortOrder=asc'),
    );
    const body1 = await res1.json();

    expect(res1.status).toBe(200);
    expect(body1.entries).toHaveLength(2);
    expect(body1.entries[0].id).toBe('2'); // 2025-01-01
    expect(body1.entries[1].id).toBe('3'); // 2025-01-02

    // Page 2 with limit 2
    const res2 = await GET(
      authenticatedRequest('?limit=2&offset=2&sortKey=timestamp&sortOrder=asc'),
    );
    const body2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(body2.entries).toHaveLength(2);
    expect(body2.entries[0].id).toBe('1'); // 2025-01-03
    expect(body2.entries[1].id).toBe('4'); // 2025-01-04

    // Verify no overlap and global ordering
    const page1Timestamps = body1.entries.map((e: any) =>
      new Date(e.timestamp).getTime(),
    );
    const page2Timestamps = body2.entries.map((e: any) =>
      new Date(e.timestamp).getTime(),
    );
    const maxPage1 = Math.max(...page1Timestamps);
    const minPage2 = Math.min(...page2Timestamps);

    expect(maxPage1).toBeLessThan(minPage2);
  });

  it('returns 405 for POST', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    expect(res.status).toBe(405);
  });
});

function authenticatedRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin-audit${query}`, {
    headers: { 'x-admin-token': 'test-admin-secret' },
  });
}
