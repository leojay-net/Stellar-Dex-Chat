/**
 * Admin Audit Log API Endpoint
 * Read-only endpoint for retrieving audit log entries with filtering
 *
 * GET /api/admin-audit
 * Query Parameters:
 *   - actionType: Filter by action type (deposit|payout|reconciliation|user_update|settings_change)
 *   - adminAddress: Filter by admin wallet address
 *   - status: Filter by status (success|failed|pending)
 *   - txHash: Filter by transaction hash
 *   - startDate: Filter entries from this date (ISO string)
 *   - endDate: Filter entries until this date (ISO string)
 *   - limit: Maximum number of entries to return (default: 100, max: 1000)
 *   - offset: Number of entries to skip for pagination (default: 0)
 *   - sortKey: Field to sort by (timestamp|actionType|status|adminAddress)
 *   - sortOrder: Sort order (asc|desc)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import AuditLogService from '@/lib/auditLog';
import { enforceAdminIpAllowlist } from '@/lib/security';
import { AuditEntry, AuditLogFilter } from '@/types';
import { requireAdminAuth } from '../admin/_utils/requireAdminAuth';

const sortKeySchema = z.enum([
  'timestamp',
  'actionType',
  'status',
  'adminAddress',
]);
const sortOrderSchema = z.enum(['asc', 'desc']);

export async function GET(request: NextRequest) {
  try {
    const blockedResponse = enforceAdminIpAllowlist(request);
    if (blockedResponse) return blockedResponse;

    const authError = requireAdminAuth(request);
    if (authError) return authError;

    const searchParams = request.nextUrl.searchParams;

    // Extract filter parameters
    const filter: AuditLogFilter = {};

    const actionType = searchParams.get('actionType');
    if (actionType) {
      filter.actionType = actionType as AuditEntry['actionType'];
    }

    const adminAddress = searchParams.get('adminAddress');
    if (adminAddress) {
      filter.adminAddress = adminAddress;
    }

    const status = searchParams.get('status');
    if (status) {
      filter.status = status as AuditEntry['status'];
    }

    const txHash = searchParams.get('txHash');
    if (txHash) {
      filter.txHash = txHash;
    }

    const startDate = searchParams.get('startDate');
    if (startDate) {
      const parsed = new Date(startDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid startDate format. Use ISO 8601 format.' },
          { status: 400 },
        );
      }
      filter.startDate = parsed;
    }

    const endDate = searchParams.get('endDate');
    if (endDate) {
      const parsed = new Date(endDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid endDate format. Use ISO 8601 format.' },
          { status: 400 },
        );
      }
      filter.endDate = parsed;
    }

    // Pagination parameters
    const rawLimit = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 1000)
      : 100;
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    // Sorting parameters
    const rawSortKey = searchParams.get('sortKey');
    const rawSortOrder = searchParams.get('sortOrder');

    let sortKey: z.infer<typeof sortKeySchema> = 'timestamp';
    let sortOrder: z.infer<typeof sortOrderSchema> = 'desc';

    if (rawSortKey) {
      const result = sortKeySchema.safeParse(rawSortKey);
      if (!result.success) {
        return NextResponse.json(
          {
            error:
              'Invalid sortKey. Must be one of: timestamp, actionType, status, adminAddress',
          },
          { status: 400 },
        );
      }
      sortKey = result.data;
    }

    if (rawSortOrder) {
      const result = sortOrderSchema.safeParse(rawSortOrder);
      if (!result.success) {
        return NextResponse.json(
          { error: 'Invalid sortOrder. Must be asc or desc' },
          { status: 400 },
        );
      }
      sortOrder = result.data;
    }

    // Retrieve filtered entries
    const allEntries = AuditLogService.getAuditEntries(filter);

    // Sort the full filtered set before pagination
    allEntries.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case 'timestamp':
          comparison =
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case 'actionType':
          comparison = a.actionType.localeCompare(b.actionType);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'adminAddress':
          comparison = a.adminAddress.localeCompare(b.adminAddress);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply pagination after sorting
    const paginatedEntries = allEntries.slice(offset, offset + limit);

    return NextResponse.json(
      {
        entries: paginatedEntries,
        total: allEntries.length,
        limit,
        offset,
        hasMore: offset + limit < allEntries.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('Error retrieving audit entries:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve audit entries' },
      { status: 500 },
    );
  }
}

// Prevent POST, PUT, DELETE operations (read-only endpoint)
export async function POST() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint is read-only.' },
    { status: 405 },
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint is read-only.' },
    { status: 405 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint is read-only.' },
    { status: 405 },
  );
}
