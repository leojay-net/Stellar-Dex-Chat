import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockEnv = { ADMIN_SECRET: 'test-admin-secret' };
vi.mock('@/lib/env', () => ({
  get env() {
    return mockEnv;
  },
}));

import { GET } from './route';

describe('GET /api/admin/reconciliation', () => {
  beforeEach(() => {
    mockEnv.ADMIN_SECRET = 'test-admin-secret';
  });

  it('returns 401 when no authentication is provided', async () => {
    const req = new NextRequest('http://localhost/api/admin/reconciliation');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Unauthorized/i);
  });

  it('returns 401 when invalid token is provided in x-admin-token', async () => {
    const req = new NextRequest('http://localhost/api/admin/reconciliation', {
      headers: { 'x-admin-token': 'wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 when valid token is provided in x-admin-token', async () => {
    const req = new NextRequest('http://localhost/api/admin/reconciliation', {
      headers: { 'x-admin-token': 'test-admin-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 200 when valid bearer token is provided', async () => {
    const req = new NextRequest('http://localhost/api/admin/reconciliation', {
      headers: { authorization: 'Bearer test-admin-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
