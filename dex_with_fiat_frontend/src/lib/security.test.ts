import { describe, expect, it } from 'vitest';
import {
  evaluateAdminIpAllowlist,
  parseIpAllowlist,
  resolveClientIp,
  type RequestWithIp,
} from './security';

function createRequest(
  headers?: Record<string, string>,
  ip?: string,
): RequestWithIp {
  return {
    headers: new Headers(headers),
    ip,
  };
}

describe('parseIpAllowlist', () => {
  it('normalizes values and captures malformed entries', () => {
    const parsed = parseIpAllowlist(
      ' 203.0.113.10, ::1 , invalid, 203.0.113.10 ',
    );

    expect(parsed.allowlist).toEqual(['203.0.113.10', '::1']);
    expect(parsed.invalidEntries).toEqual(['invalid']);
  });
});

describe('resolveClientIp', () => {
  it('prefers x-forwarded-for and takes the first hop', () => {
    const request = createRequest({
      'x-forwarded-for': '203.0.113.10, 198.51.100.25',
      'x-real-ip': '198.51.100.25',
    });

    expect(resolveClientIp(request)).toBe('203.0.113.10');
  });

  it('handles forwarded header format', () => {
    const request = createRequest({
      forwarded: 'for="198.51.100.45";proto=https;host=example.com',
    });

    expect(resolveClientIp(request)).toBe('198.51.100.45');
  });
});

describe('evaluateAdminIpAllowlist', () => {
  it('allows requests when allowlist is not configured', () => {
    const evaluation = evaluateAdminIpAllowlist(
      createRequest({ 'x-real-ip': '203.0.113.10' }),
      { allowlistRaw: '' },
    );

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.validation.reason).toBe('allowlist_disabled');
  });

  it('rejects non-allowlisted requests with 403', () => {
    const evaluation = evaluateAdminIpAllowlist(
      createRequest({ 'x-real-ip': '203.0.113.10' }),
      {
        allowlistRaw: '198.51.100.25',
        bypassLocal: false,
        nodeEnv: 'production',
      },
    );

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.status).toBe(403);
    expect(evaluation.code).toBe('ADMIN_IP_NOT_ALLOWLISTED');
    expect(evaluation.validation.reason).toBe('allowlist_denied');
  });

  it('allows explicitly allowlisted requests', () => {
    const evaluation = evaluateAdminIpAllowlist(
      createRequest({ 'x-real-ip': '198.51.100.25' }),
      { allowlistRaw: '198.51.100.25' },
    );

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.validation.reason).toBe('allowlist_allowed');
  });

  it('supports localhost bypass in non-production', () => {
    const evaluation = evaluateAdminIpAllowlist(
      createRequest({ 'x-real-ip': '127.0.0.1' }),
      {
        allowlistRaw: '198.51.100.25',
        bypassLocal: true,
        nodeEnv: 'development',
      },
    );

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.validation.reason).toBe('allowlist_bypass_local');
  });

  it('ignores localhost bypass in production', () => {
    const evaluation = evaluateAdminIpAllowlist(
      createRequest({ 'x-real-ip': '127.0.0.1' }),
      {
        allowlistRaw: '198.51.100.25',
        bypassLocal: true,
        nodeEnv: 'production',
      },
    );

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.code).toBe('ADMIN_IP_NOT_ALLOWLISTED');
  });

  it('returns a clear validation payload for malformed allowlist', () => {
    const evaluation = evaluateAdminIpAllowlist(
      createRequest({ 'x-real-ip': '203.0.113.10' }),
      {
        allowlistRaw: 'bad-ip,198.51.100.25',
      },
    );

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.status).toBe(500);
    expect(evaluation.code).toBe('ADMIN_IP_ALLOWLIST_INVALID');
    expect(evaluation.validation.invalidEntries).toEqual(['bad-ip']);
    expect(evaluation.validation.reason).toBe('allowlist_misconfigured');
  });
});
