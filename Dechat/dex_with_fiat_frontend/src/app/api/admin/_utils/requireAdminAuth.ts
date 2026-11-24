import { serverEnv as env } from '@/lib/serverEnv';

// Extend global type for cleanup intervals
declare global {
  var sessionCleanupInterval: ReturnType<typeof setInterval> | undefined;
  var nonceCleanupInterval: ReturnType<typeof setInterval> | undefined;
}

// In-memory session store (in production, use Redis or database)
const sessions = new Map<string, { address: string; expires: number }>();

// Clean up expired sessions periodically
if (typeof global.sessionCleanupInterval === 'undefined') {
  global.sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, data] of sessions.entries()) {
      if (data.expires < now) {
        sessions.delete(token);
      }
    }
  }, 60 * 1000);
}

export function setAdminSession(token: string, address: string, ttlMs: number) {
  sessions.set(token, {
    address,
    expires: Date.now() + ttlMs,
  });
}

export function deleteAdminSession(token: string) {
  sessions.delete(token);
}

export function requireAdminAuth(request: Request): Response | null {
  const configuredSecret = env.ADMIN_SECRET;

  const headerToken = request.headers.get('x-admin-token');
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  // Basic check: match against secret (header is preferred) - for automation
  if (
    configuredSecret &&
    (headerToken === configuredSecret || bearerToken === configuredSecret)
  ) {
    return null;
  }

  // Check session cookie
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const sessionMatch = cookieHeader.match(/admin_session=([^;]+)/);
    if (sessionMatch) {
      const sessionToken = sessionMatch[1];
      const session = sessions.get(sessionToken);

      if (session && session.expires > Date.now()) {
        return null; // Valid session
      }

      // Session expired or invalid, delete it
      sessions.delete(sessionToken);
    }
  }

  return Response.json(
    { error: 'Unauthorized: admin authentication required' },
    { status: 401 },
  );
}
