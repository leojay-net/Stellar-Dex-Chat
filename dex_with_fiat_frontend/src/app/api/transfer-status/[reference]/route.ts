import { NextRequest, NextResponse } from 'next/server';
import { getTransferStatus, setTransferStatus } from '@/lib/transferStore';

// Temporary memory store to mark cancellation requests.
// In a full production app, this would update a database record.
const cancelledTransfers = new Set<string>();

export async function POST(
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

    cancelledTransfers.add(reference);
    const existing = getTransferStatus(reference);
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
