import { describe, expect, it } from 'vitest';

const { GET, HEAD } = await import('./route');

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

it('answers HEAD with an uncached response and no body', () => {
  const response = HEAD();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.body).toBeNull();
});
