import { NextRequest, NextResponse } from 'next/server';
import { getPayoutProvider } from '@/lib/payout/providers/registry';
import { telemetry } from '@/lib/telemetry';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyAccountSchema } from '@/lib/apiSchemas';

const RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/verify-account', RATE_LIMIT);
  if (limited) return limited;

  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'verify-account',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    telemetry.addLog(span.spanId, 'info', 'Starting account verification', {
      endpoint: '/api/verify-account',
    });

    const body = await request.json();

    // Validate with Zod
    const validationResult = verifyAccountSchema.safeParse(body);

    if (!validationResult.success) {
      telemetry.addLog(span.spanId, 'warn', 'Zod validation failed', {
        errors: validationResult.error.issues,
      });
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'Validation failed',
      });

      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const { accountNumber, bankCode } = validationResult.data;

    telemetry.addLog(span.spanId, 'info', 'Request validated', {
      hasAccountNumber: !!accountNumber,
      hasBankCode: !!bankCode,
      bankCode: bankCode,
    });

    const provider = getPayoutProvider();
    const data = await provider.verifyAccount({ accountNumber, bankCode });

    telemetry.finishSpan(span.spanId, { success: true });

    const apiResponse = NextResponse.json({ success: true, data });
    telemetry.setTraceHeaders(apiResponse.headers, traceContext);
    return apiResponse;
  } catch (error: unknown) {
    telemetry.addLog(
      span.spanId,
      'error',
      'Unhandled error in account verification',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );

    console.error('Account verification error:', error);

    const axiosError = error as {
      response?: { status?: number; data?: { message?: string } };
    };

    if (axiosError.response?.status === 422) {
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'Invalid account number or bank code',
        errorType: 'validation_error',
      });
      return NextResponse.json(
        { success: false, message: 'Invalid account number or bank code' },
        { status: 400 },
      );
    }

    if (axiosError.response?.data?.message) {
      const message = axiosError.response.data.message;
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: message,
        errorType: 'paystack_api_error',
      });
      return NextResponse.json({ success: false, message }, { status: 400 });
    }

    telemetry.finishSpan(span.spanId, {
      success: false,
      error: 'Account verification failed. Please try again.',
      errorType: 'unknown_error',
    });

    return NextResponse.json(
      {
        success: false,
        message: 'Account verification failed. Please try again.',
      },
      { status: 500 },
    );
  }
}
