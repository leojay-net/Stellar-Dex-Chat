import { env } from '@/lib/env';

export function requireAdminAuth(request: Request): Response | null {
  const configuredSecret = env.ADMIN_SECRET;

  const headerToken = request.headers.get('x-admin-token');
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  // Basic check: match against secret (header is preferred)
  if (configuredSecret && (headerToken === configuredSecret || bearerToken === configuredSecret)) {
    return null;
  }

  return Response.json(
    { error: 'Unauthorized: admin authentication required' },
    { status: 401 },
  );
}
