'use client';

import NetworkModalHarness from '@/components/e2e/NetworkModalHarness';

/** E2E harness route for network-status-modal.spec.ts (#1494). */
export default function TestNetworkModalLightPage() {
  return <NetworkModalHarness variant="connected" dark={false} />;
}
