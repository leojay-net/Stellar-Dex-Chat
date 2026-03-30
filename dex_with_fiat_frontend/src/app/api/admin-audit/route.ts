import { NextRequest, NextResponse } from 'next/server';
import { enforceAdminIpAllowlist } from '@/lib/security';

interface AdminAuditEvent {
  id: string;
  actor: string;
  action: string;
  resource: string;
  timestamp: string;
}

const mockAuditEvents: AdminAuditEvent[] = [
  {
    id: 'audit_1',
    actor: 'system',
    action: 'transfer_reviewed',
    resource: 'TRF_123456',
    timestamp: '2026-03-24T10:30:00Z',
  },
  {
    id: 'audit_2',
    actor: 'admin',
    action: 'reconciliation_exported',
    resource: 'daily_report_2026-03-24',
    timestamp: '2026-03-24T11:15:00Z',
  },
];

export async function GET(request: NextRequest) {
  const blockedResponse = enforceAdminIpAllowlist(request);
  if (blockedResponse) return blockedResponse;

  return NextResponse.json({
    events: mockAuditEvents,
    count: mockAuditEvents.length,
  });
}
