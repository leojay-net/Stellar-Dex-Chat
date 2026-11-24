import { describe, it, expect, vi } from 'vitest';

vi.mock('../_utils/requireAdminAuth', () => ({
  requireAdminAuth: () => null,
}));

import { DELETE, GET } from './route';

describe('/api/admin/audit-log is append-only (#1484)', () => {
  it('rejects DELETE with 405 and does not clear entries', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/admin/audit-log', { method: 'DELETE' }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');

    const list = await GET(new Request('http://localhost/api/admin/audit-log'));
    const body = await list.json();
    expect(body.total).toBeGreaterThan(0);
  });
});
