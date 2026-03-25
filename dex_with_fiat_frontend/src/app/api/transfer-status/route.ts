import { NextRequest, NextResponse } from 'next/server';

import { getPayoutProvider } from '@/lib/payout/providers/registry';
import { telemetry } from '@/lib/telemetry';

export async function POST(request: NextRequest) {
  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'transfer-status',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    const { reference } = await request.json();

    telemetry.addLog(span.spanId, 'info', 'Starting transfer status check', {
      endpoint: '/api/transfer-status',
      reference: reference,
    });

    if (!reference) {
      telemetry.addLog(span.spanId, 'warn', 'Validation failed', {
        missingFields: {
          reference: !reference,
        },
      });
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'Reference is required',
      });

      return NextResponse.json(
        { success: false, message: 'Reference is required' },
        { status: 400 },
      );
    }

    const provider = getPayoutProvider();
    const data = await provider.checkTransferStatus({ reference });

    // Add cancellation information if present
    let enhancedData = data;
    if (data.status === 'cancelled' || data.cancellationReason) {
      enhancedData = {
        ...data,
        isCancelled: true,
        cancellationInfo: {
          cancelledAt: data.cancelledAt,
          reason: data.cancellationReason,
          canCancel: false,
        },
        timeline: [
          ...(data.timeline || []),
          {
            status: 'cancelled',
            message: data.cancellationReason || 'Transfer was cancelled',
            timestamp: data.cancelledAt || new Date().toISOString(),
          },
        ],
      };
    } else {
      // Check if transfer can still be cancelled (within 2 minutes)
      const createdAt = new Date(data.createdAt);
      const now = new Date();
      const timeDiff = now.getTime() - createdAt.getTime();
      const twoMinutesInMs = 2 * 60 * 1000;
      const canCancel = timeDiff <= twoMinutesInMs && data.status === 'pending';

      enhancedData = {
        ...data,
        isCancelled: false,
        canCancel,
        cancellationWindow: {
          expiresAt: new Date(createdAt.getTime() + twoMinutesInMs).toISOString(),
          timeRemaining: Math.max(0, twoMinutesInMs - timeDiff),
        },
      };
    }

    telemetry.addLog(span.spanId, 'info', 'Transfer status retrieved successfully', {
      reference: reference,
      status: data.status,
      isCancelled: enhancedData.isCancelled,
      canCancel: enhancedData.canCancel,
    });
    telemetry.finishSpan(span.spanId, { success: true });

    const response = NextResponse.json({
      success: true,
      data: enhancedData,
    });

    telemetry.setTraceHeaders(response.headers, traceContext);
    return response;
  } catch (error: unknown) {
    telemetry.addLog(
      span.spanId,
      'error',
      'Error fetching transfer status',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );

    console.error('Transfer status error:', error);

    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'data' in error.response &&
      error.response.data &&
      typeof error.response.data === 'object' &&
      'message' in error.response.data
    ) {
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: (error.response.data as { message: string }).message,
      });

      return NextResponse.json(
        {
          success: false,
          message: (error.response.data as { message: string }).message,
        },
        { status: 400 },
      );
    }

    telemetry.finishSpan(span.spanId, {
      success: false,
      error: 'Failed to fetch transfer status. Please try again.',
    });

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch transfer status. Please try again.',
      },
      { status: 500 },
    );
  }
}
