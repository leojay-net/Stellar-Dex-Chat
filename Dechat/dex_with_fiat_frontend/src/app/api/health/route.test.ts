import { describe, expect, it } from 'vitest';

const { GET } = await import('./route');

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    // timestamp should be a valid ISO date
    expect(Number.isNaN(new Date(body.timestamp).getTime())).toBe(false);
  });
});
