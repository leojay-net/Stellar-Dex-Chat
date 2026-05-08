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
 */

import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@/lib/auditLog';
import { AuditEntry, AuditLogFilter } from '@/types';

export async function GET(request: NextRequest) {
  try {
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
      try {
        filter.startDate = new Date(startDate);
      } catch {
        return NextResponse.json(
          { error: 'Invalid startDate format. Use ISO 8601 format.' },
          { status: 400 }
        );
      }
    }

    const endDate = searchParams.get('endDate');
    if (endDate) {
      try {
        filter.endDate = new Date(endDate);
      } catch {
        return NextResponse.json(
          { error: 'Invalid endDate format. Use ISO 8601 format.' },
          { status: 400 }
        );
      }
    }

    // Pagination parameters
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      1000 // Max limit
    );
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    // Retrieve filtered entries
    const allEntries = AuditLogService.getAuditEntries(filter);

    // Apply pagination
    const paginatedEntries = allEntries.slice(offset, offset + limit);

    // Sort by timestamp descending (most recent first)
    paginatedEntries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

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
      }
    );
  } catch (error) {
    console.error('Error retrieving audit entries:', error);
    return NextResponse.json(
      {
        error: 'Failed to retrieve audit entries',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Prevent POST, PUT, DELETE operations (read-only endpoint)
export async function POST() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint is read-only.' },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint is read-only.' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed. This endpoint is read-only.' },
    { status: 405 }
  );
}
