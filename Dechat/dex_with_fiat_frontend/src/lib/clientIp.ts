import net from 'node:net';

export interface RequestWithClientIp {
  headers: Headers;
  ip?: string | null;
}

export function normalizeCandidateIp(raw: string): string {
  let candidate = raw.trim();

  if (candidate.toLowerCase().startsWith('for=')) {
    candidate = candidate.slice(4).trim();
  }
  if (candidate.includes(';')) candidate = candidate.split(';')[0].trim();
  if (candidate.startsWith('"')) candidate = candidate.slice(1);
  if (candidate.endsWith('"')) candidate = candidate.slice(0, -1);
  if (candidate.startsWith('[') && candidate.includes(']')) {
    candidate = candidate.slice(1, candidate.indexOf(']'));
  }

  const ipv4WithPortMatch = candidate.match(/^([\d.]+):\d+$/);
  if (ipv4WithPortMatch) candidate = ipv4WithPortMatch[1];
  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.slice('::ffff:'.length);
  }

  return candidate;
}

export function isValidIp(value: string): boolean {
  return net.isIP(value) !== 0;
}

function parseTrustedProxyHops(): number {
  const configured = Number(process.env.TRUSTED_PROXY_HOPS ?? '0');
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 0;
}

function validAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeCandidateIp(raw);
  return isValidIp(normalized) ? normalized : null;
}

export function getClientIp(request: RequestWithClientIp): string {
  const requestIp = validAddress(request.ip);
  if (requestIp) return requestIp;

  for (const headerName of [
    'cf-connecting-ip',
    'x-vercel-forwarded-for',
    'x-real-ip',
  ]) {
    const address = validAddress(request.headers.get(headerName));
    if (address) return address;
  }

  const trustedHops = parseTrustedProxyHops();
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (trustedHops > 0 && forwardedFor) {
    const chain = forwardedFor.split(',').map((hop) => validAddress(hop));
    if (chain.every((hop): hop is string => hop !== null)) {
      const clientIndex = chain.length - trustedHops - 1;
      if (clientIndex >= 0) return chain[clientIndex];
    }
  }

  return 'unknown';
}
