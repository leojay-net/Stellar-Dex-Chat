import { env } from '@/lib/env';

export function requireAdminAuth(request: Request): Response | null {
  const configuredToken = env.ADMIN_API_TOKEN;

  // Keep development ergonomics when no token is configured.
  if (!configuredToken) {
    return null;
  }

  const headerToken = request.headers.get('x-admin-token');
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  if (headerToken === configuredToken || bearerToken === configuredToken) {
    return null;
  }

  return Response.json(
    { error: 'Unauthorized: admin authentication required' },
    { status: 401 },
  );
}
