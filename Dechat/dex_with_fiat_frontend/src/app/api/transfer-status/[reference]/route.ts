import { NextRequest, NextResponse } from 'next/server';
import { getTransferStatus, setTransferStatus } from '@/lib/transferStore';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';

const RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 };

// Temporary memory store to mark cancellation requests.
// In a full production app, this would update a database record.
const cancelledTransfers = new Set<string>();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/transfer-status', RATE_LIMIT);
  if (limited) return limited;

  try {
    const p = await params;
    const { reference } = p;

    if (!reference) {
      return NextResponse.json(
        { success: false, message: 'Reference is required' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const clientSessionId = body.clientSessionId as string | undefined;

    const existing = getTransferStatus(reference);
    if (!existing) {
      return NextResponse.json(
        { success: false, message: 'Transfer not found' },
        { status: 404 },
      );
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { success: false, message: 'Only pending transfers can be cancelled' },
        { status: 409 },
      );
    }

    if (clientSessionId && existing.clientSessionId !== clientSessionId) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 403 },
      );
    }

    cancelledTransfers.add(reference);
    setTransferStatus({
      reference,
      status: 'cancelled',
      amount: existing?.amount ?? 0,
      updatedAt: new Date().toISOString(),
      clientSessionId: existing?.clientSessionId,
      failureReason: existing?.failureReason,
    });

    return NextResponse.json({
      success: true,
      data: {
        reference,
        status: 'cancelled',
        message: 'Transfer cancellation requested successfully',
      },
    });
  } catch (error: unknown) {
    console.error('Cancel transfer error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to cancel transfer' },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  try {
    const p = await params;
    const { reference } = p;

    if (!reference) {
      return NextResponse.json(
        { success: false, message: 'Reference is required' },
        { status: 400 },
      );
    }

    if (cancelledTransfers.has(reference)) {
      const existing = getTransferStatus(reference);
      return NextResponse.json({
        success: true,
        data: {
          reference,
          status: 'cancelled',
          amount: existing?.amount ?? 0,
          message: 'Transfer cancellation requested successfully',
        },
      });
    }

    const transferRecord = getTransferStatus(reference);
    if (transferRecord) {
      return NextResponse.json({
        success: true,
        data: transferRecord,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        reference,
        status: 'pending',
      },
    });
  } catch (error: unknown) {
    console.error('Get transfer status error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve transfer status' },
      { status: 500 },
    );
  }
}
