import {
  AdminAuditActionType,
  AdminAuditLogEntry,
  AdminAuditResult,
} from '../../../../types';
import { requireAdminAuth } from '../_utils/requireAdminAuth';

const ACTIONS: AdminAuditActionType[] = [
  'withdrawal_approved',
  'withdrawal_rejected',
  'reconciliation_adjustment',
  'operator_added',
  'operator_removed',
  'bridge_paused',
  'bridge_unpaused',
];

const RESULT_BY_ACTION: Record<AdminAuditActionType, AdminAuditResult> = {
  withdrawal_approved: 'success',
  withdrawal_rejected: 'failed',
  reconciliation_adjustment: 'success',
  operator_added: 'success',
  operator_removed: 'success',
  bridge_paused: 'pending',
  bridge_unpaused: 'success',
};

const mockAuditLogData: AdminAuditLogEntry[] = Array.from(
  { length: 58 },
  (_, index) => {
    const action = ACTIONS[index % ACTIONS.length];
    const timestamp = new Date(
      Date.UTC(2026, 2, 29, 19, 0, 0) - index * 16 * 60 * 1000,
    ).toISOString();

    return {
      id: `audit_${String(index + 1).padStart(4, '0')}`,
      timestamp,
      action,
      adminAddress: `GADMIN${String((index % 9) + 1).padStart(2, '0')}...${String((index % 97) + 11).padStart(2, '0')}`,
      parameters: {
        amountXlm: Number((12 + (index % 13) * 2.5).toFixed(2)),
        requestId: `REQ-${20260300 + index + 1}`,
        target: `GBENEFICIARY${String((index % 14) + 1).padStart(2, '0')}...`,
        dryRun: index % 6 === 0,
      },
      result: RESULT_BY_ACTION[action],
    };
  },
);

const DEFAULT_PAGE_SIZE = 20;

export async function GET(request: Request) {
  try {
    const authError = requireAdminAuth(request);
    if (authError) {
      return authError;
    }

    const { searchParams } = new URL(request.url);
    const actionFilter = searchParams.get('action') || 'all';
    const page = Math.max(Number(searchParams.get('page') || 1), 1);

    const filteredEntries =
      actionFilter === 'all'
        ? mockAuditLogData
        : mockAuditLogData.filter((entry) => entry.action === actionFilter);

    const total = filteredEntries.length;
    const totalPages = Math.max(Math.ceil(total / DEFAULT_PAGE_SIZE), 1);
    const boundedPage = Math.min(page, totalPages);
    const startIndex = (boundedPage - 1) * DEFAULT_PAGE_SIZE;
    const entries = filteredEntries.slice(startIndex, startIndex + DEFAULT_PAGE_SIZE);

    return Response.json({
      entries,
      page: boundedPage,
      pageSize: DEFAULT_PAGE_SIZE,
      total,
      totalPages,
      actions: ACTIONS,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return Response.json(
      { error: 'Failed to fetch admin audit logs' },
      { status: 500 },
    );
  }
}
