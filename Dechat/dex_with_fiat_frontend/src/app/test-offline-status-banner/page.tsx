'use client';

import OfflineStatusBanner from '@/components/OfflineStatusBanner';

/**
 * Test harness page for OfflineStatusBanner E2E tests.
 *
 * The banner reads `navigator.onLine` and listens to "online"/"offline" events,
 * so tests can drive it by dispatching those events via page.evaluate().
 *
 * It also calls the Cloudflare connectivity endpoint which tests should
 * intercept via page.route().
 */
export default function TestOfflineStatusBannerPage() {
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-lg font-semibold mb-4">OfflineStatusBanner Test Harness</h1>
      <p className="text-sm text-gray-600">
        The banner renders fixed at the top of the viewport when offline.
      </p>
      <OfflineStatusBanner />
    </main>
  );
}
