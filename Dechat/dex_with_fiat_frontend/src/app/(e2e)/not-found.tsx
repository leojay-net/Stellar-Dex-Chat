import { notFound } from 'next/navigation';

/**
 * Route group guard for E2E test harness pages.
 *
 * These pages are only available when NEXT_PUBLIC_E2E='true' is set.
 * In production builds, this returns a 404, preventing the test routes
 * from being included in the build output.
 */
export default function E2ERouteGuard() {
  if (process.env.NEXT_PUBLIC_E2E !== 'true') {
    notFound();
  }
  return null;
}
