import { NextResponse } from 'next/server';
import net from 'node:net';
import { env } from '@/lib/env';

export interface RequestWithIp {
  headers: Headers;
  ip?: string | null;
}

interface AdminIpAllowlistConfig {
  allowlist: string[];
  invalidEntries: string[];
  bypassLocal: boolean;
  nodeEnv: string;
  enabled: boolean;
}

export interface AdminIpAllowlistValidation {
  reason:
    | 'allowlist_disabled'
    | 'allowlist_bypass_local'
    | 'allowlist_allowed'
    | 'allowlist_denied'
    | 'allowlist_ip_unresolved'
    | 'allowlist_misconfigured';
  requestIp: string | null;
  allowlistEnabled: boolean;
  bypassLocal: boolean;
  allowlistCount: number;
  invalidEntries: string[];
}

export interface AdminIpAllowlistEvaluation {
  allowed: boolean;
  status: number | null;
  code: string | null;
  message: string | null;
  validation: AdminIpAllowlistValidation;
}

interface ConfigInput {
  allowlistRaw?: string;
  bypassLocal?: boolean;
  nodeEnv?: string;
}

const LOOPBACK_IPV6 = '::1';

function normalizeCandidateIp(raw: string): string {
  let candidate = raw.trim();

  const forwardedPrefix = 'for=';
  if (candidate.toLowerCase().startsWith(forwardedPrefix)) {
    candidate = candidate.slice(forwardedPrefix.length).trim();
  }

  if (candidate.includes(';')) {
    candidate = candidate.split(';')[0].trim();
  }

  if (candidate.startsWith('"')) {
    candidate = candidate.slice(1);
  }
  if (candidate.endsWith('"')) {
    candidate = candidate.slice(0, -1);
  }

  if (candidate.startsWith('[') && candidate.includes(']')) {
    candidate = candidate.slice(1, candidate.indexOf(']'));
  }

  const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch) {
    candidate = ipv4WithPortMatch[1];
  }

  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.slice('::ffff:'.length);
  }

  return candidate;
}

function isValidIp(value: string): boolean {
  return net.isIP(value) !== 0;
}

function isLoopbackIp(ip: string): boolean {
  if (ip === LOOPBACK_IPV6) return true;
  return ip.startsWith('127.');
}

function readAdminIpAllowlistConfig(
  input?: ConfigInput,
): AdminIpAllowlistConfig {
  const parsed = parseIpAllowlist(
    input?.allowlistRaw ?? env.ADMIN_IP_ALLOWLIST,
  );
  return {
    allowlist: parsed.allowlist,
    invalidEntries: parsed.invalidEntries,
    bypassLocal: input?.bypassLocal ?? env.ADMIN_IP_ALLOWLIST_BYPASS_LOCAL,
    nodeEnv: input?.nodeEnv ?? process.env.NODE_ENV ?? 'development',
    enabled: parsed.allowlist.length > 0,
  };
}

export function parseIpAllowlist(rawAllowlist?: string): {
  allowlist: string[];
  invalidEntries: string[];
} {
  if (!rawAllowlist || !rawAllowlist.trim()) {
    return { allowlist: [], invalidEntries: [] };
  }

  const allowlist = new Set<string>();
  const invalidEntries: string[] = [];

  for (const entry of rawAllowlist.split(',')) {
    const normalized = normalizeCandidateIp(entry);

    if (!normalized) continue;

    if (!isValidIp(normalized)) {
      invalidEntries.push(entry.trim());
      continue;
    }

    allowlist.add(normalized);
  }

  return {
    allowlist: [...allowlist],
    invalidEntries,
  };
}

export function resolveClientIp(request: RequestWithIp): string | null {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0]?.trim();
    if (first) {
      const normalized = normalizeCandidateIp(first);
      if (isValidIp(normalized)) return normalized;
    }
  }

  const forwarded = request.headers.get('forwarded');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      const normalized = normalizeCandidateIp(first);
      if (isValidIp(normalized)) return normalized;
    }
  }

  const directHeaders = [
    'x-real-ip',
    'cf-connecting-ip',
    'x-vercel-forwarded-for',
  ];

  for (const headerName of directHeaders) {
    const value = request.headers.get(headerName);
    if (!value) continue;

    const normalized = normalizeCandidateIp(value);
    if (isValidIp(normalized)) return normalized;
  }

  const fallbackIp = request.ip ? normalizeCandidateIp(request.ip) : null;
  if (fallbackIp && isValidIp(fallbackIp)) return fallbackIp;

  return null;
}

export function evaluateAdminIpAllowlist(
  request: RequestWithIp,
  input?: ConfigInput,
): AdminIpAllowlistEvaluation {
  const config = readAdminIpAllowlistConfig(input);
  const requestIp = resolveClientIp(request);

  if (config.invalidEntries.length > 0) {
    return {
      allowed: false,
      status: 500,
      code: 'ADMIN_IP_ALLOWLIST_INVALID',
      message: 'Admin IP allowlist is misconfigured.',
      validation: {
        reason: 'allowlist_misconfigured',
        requestIp,
        allowlistEnabled: config.enabled,
        bypassLocal: config.bypassLocal,
        allowlistCount: config.allowlist.length,
        invalidEntries: config.invalidEntries,
      },
    };
  }

  if (!config.enabled) {
    return {
      allowed: true,
      status: null,
      code: null,
      message: null,
      validation: {
        reason: 'allowlist_disabled',
        requestIp,
        allowlistEnabled: false,
        bypassLocal: config.bypassLocal,
        allowlistCount: 0,
        invalidEntries: [],
      },
    };
  }

  const bypassInEffect =
    config.bypassLocal &&
    config.nodeEnv !== 'production' &&
    requestIp !== null &&
    isLoopbackIp(requestIp);

  if (bypassInEffect) {
    return {
      allowed: true,
      status: null,
      code: null,
      message: null,
      validation: {
        reason: 'allowlist_bypass_local',
        requestIp,
        allowlistEnabled: true,
        bypassLocal: true,
        allowlistCount: config.allowlist.length,
        invalidEntries: [],
      },
    };
  }

  if (!requestIp) {
    return {
      allowed: false,
      status: 403,
      code: 'ADMIN_IP_UNRESOLVED',
      message:
        'Forbidden: unable to resolve client IP for admin allowlist validation.',
      validation: {
        reason: 'allowlist_ip_unresolved',
        requestIp: null,
        allowlistEnabled: true,
        bypassLocal: config.bypassLocal,
        allowlistCount: config.allowlist.length,
        invalidEntries: [],
      },
    };
  }

  if (!config.allowlist.includes(requestIp)) {
    return {
      allowed: false,
      status: 403,
      code: 'ADMIN_IP_NOT_ALLOWLISTED',
      message: 'Forbidden: request IP is not authorized for this admin route.',
      validation: {
        reason: 'allowlist_denied',
        requestIp,
        allowlistEnabled: true,
        bypassLocal: config.bypassLocal,
        allowlistCount: config.allowlist.length,
        invalidEntries: [],
      },
    };
  }

  return {
    allowed: true,
    status: null,
    code: null,
    message: null,
    validation: {
      reason: 'allowlist_allowed',
      requestIp,
      allowlistEnabled: true,
      bypassLocal: config.bypassLocal,
      allowlistCount: config.allowlist.length,
      invalidEntries: [],
    },
  };
}

export function enforceAdminIpAllowlist(
  request: RequestWithIp,
  input?: ConfigInput,
): NextResponse | null {
  const evaluation = evaluateAdminIpAllowlist(request, input);
  if (evaluation.allowed) return null;

  return NextResponse.json(
    {
      error: evaluation.message,
      code: evaluation.code,
      validation: evaluation.validation,
    },
    { status: evaluation.status ?? 403 },
  );
}
