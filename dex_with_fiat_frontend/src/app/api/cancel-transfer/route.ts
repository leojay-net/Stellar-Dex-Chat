import { NextRequest, NextResponse } from 'next/server';
import { getPayoutProvider } from '@/lib/payout/providers/registry';
import { telemetry } from '@/lib/telemetry';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';
import { env } from '@/lib/env';

const RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/cancel-transfer', RATE_LIMIT);
  if (limited) return limited;

  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'cancel-transfer',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    telemetry.addLog(span.spanId, 'info', 'Starting transfer cancellation', {
      endpoint: '/api/cancel-transfer',
    });

    const { reference, reason } = await request.json();

    telemetry.addLog(span.spanId, 'info', 'Request parsed', {
      hasReference: !!reference,
      hasReason: !!reason,
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
        error: 'Missing required fields',
      });

      return NextResponse.json(
        {
          success: false,
          message: 'Reference is required',
        },
        { status: 400 },
      );
    }

    const provider = getPayoutProvider();
    const data = await provider.cancelTransfer({
      reference,
      reason: reason || 'User requested cancellation',
    });

    telemetry.addLog(span.spanId, 'info', 'Transfer cancelled successfully', {
      reference: reference,
      status: data.status,
    });
    telemetry.finishSpan(span.spanId, { success: true });

    const response = NextResponse.json({
      success: true,
      data,
    });

    telemetry.setTraceHeaders(response.headers, traceContext);
    return response;
  } catch (error: unknown) {
    telemetry.addLog(
      span.spanId,
      'error',
      'Error cancelling transfer',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );

    console.error('Cancel transfer error:', error);

    // Handle specific error messages
    if (error instanceof Error) {
      let errorMessage = error.message;
      let statusCode = 400;

      // Specific error handling for different scenarios
      if (error.message.includes('within 2 minutes')) {
        errorMessage = 'Transfer can only be cancelled within 2 minutes of initiation';
        statusCode = 400;
      } else if (error.message.includes('not found')) {
        errorMessage = 'Transfer not found';
        statusCode = 404;
      } else if (error.message.includes('Cannot cancel transfer')) {
        errorMessage = error.message;
        statusCode = 400;
      } else {
        errorMessage = 'Failed to cancel transfer. Please try again.';
        statusCode = 500;
      }

      telemetry.finishSpan(span.spanId, {
        success: false,
        error: errorMessage,
      });

      return NextResponse.json(
        {
          success: false,
          message: errorMessage,
        },
        { status: statusCode },
      );
    }

    telemetry.finishSpan(span.spanId, {
      success: false,
      error: 'Failed to cancel transfer. Please try again.',
    });

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to cancel transfer. Please try again.',
      },
      { status: 500 },
    );
  }
}
