import { NextRequest, NextResponse } from 'next/server';
import { getPayoutProvider } from '@/lib/payout/providers/registry';
import axios from 'axios';
import { telemetry } from '@/lib/telemetry';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';
import { env } from '@/lib/env';
import { createRecipientSchema } from '@/lib/apiSchemas';

const PAYSTACK_SECRET_KEY = env.PAYSTACK_SECRET_KEY;
const RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/create-recipient', RATE_LIMIT);
  if (limited) return limited;

  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'create-recipient',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    telemetry.addLog(span.spanId, 'info', 'Starting recipient creation', {
      endpoint: '/api/create-recipient',
    });

    const body = await request.json();

    // Validate with Zod
    const validationResult = createRecipientSchema.safeParse(body);

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

    const { type, name, account_number, bank_code, currency } =
      validationResult.data;

    telemetry.addLog(span.spanId, 'info', 'Request validated', {
      hasType: !!type,
      hasName: !!name,
      hasAccountNumber: !!account_number,
      hasBankCode: !!bank_code,
      hasCurrency: !!currency,
      currency: currency,
    });

    const provider = getPayoutProvider();
    const data = await provider.createRecipient({
      type,
      name,
      account_number,
      bank_code,
      currency,
    });

    return NextResponse.json({
      success: true,
      data,
    });
    if (!PAYSTACK_SECRET_KEY) {
      telemetry.addLog(
        span.spanId,
        'warn',
        'Using mock recipient creation (no API key)',
        { endpoint: '/api/create-recipient' },
      );

      // Mock recipient creation when API key is missing
      const mockRecipient = {
        active: true,
        createdAt: new Date().toISOString(),
        currency: currency,
        domain: 'test',
        id: Math.floor(Math.random() * 1000000),
        integration: 123456,
        name: name,
        recipient_code: `RCP_${Math.random().toString(36).substr(2, 9)}`,
        type: type,
        updatedAt: new Date().toISOString(),
        is_deleted: false,
        details: {
          authorization_code: null,
          account_number: account_number,
          account_name: name,
          bank_code: bank_code,
          bank_name: 'Mock Bank',
        },
      };

      await new Promise((resolve) => setTimeout(resolve, 1000));

      telemetry.addLog(span.spanId, 'info', 'Mock recipient created', {
        recipientCode: mockRecipient.recipient_code,
        name: name,
        currency: currency,
      });
      telemetry.finishSpan(span.spanId, { success: true, mock: true });

      const response = NextResponse.json({
        success: true,
        data: mockRecipient,
      });

      telemetry.setTraceHeaders(response.headers, traceContext);
      return response;
    }

    // Call real Paystack API to create recipient
    telemetry.addLog(span.spanId, 'info', 'Calling Paystack API', {
      endpoint: 'https://api.paystack.co/transferrecipient',
      type: type,
      currency: currency,
      bank_code: bank_code,
    });

    const response = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type: type,
        name: name,
        account_number: account_number,
        bank_code: bank_code,
        currency: currency,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.data.status && response.data.data) {
      telemetry.addLog(
        span.spanId,
        'info',
        'Paystack recipient creation successful',
        {
          recipientCode: response.data.data.recipient_code,
          name: response.data.data.name,
          currency: response.data.data.currency,
        },
      );
      telemetry.finishSpan(span.spanId, { success: true });

      const apiResponse = NextResponse.json({
        success: true,
        data: response.data.data,
      });

      telemetry.setTraceHeaders(apiResponse.headers, traceContext);
      return apiResponse;
    } else {
      telemetry.addLog(span.spanId, 'error', 'Paystack API returned error', {
        message: response.data.message,
        status: response.data.status,
      });
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: response.data.message,
      });

      return NextResponse.json(
        {
          success: false,
          message: response.data.message || 'Failed to create recipient',
        },
        { status: 400 },
      );
    }
  } catch (error: unknown) {
    telemetry.addLog(
      span.spanId,
      'error',
      'Unhandled error in recipient creation',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );

    console.error('Create recipient error:', error);

    // Handle Paystack API errors
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
        errorType: 'paystack_api_error',
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
      error: 'Failed to create recipient. Please try again.',
      errorType: 'unknown_error',
    });

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to create recipient. Please try again.',
      },
      { status: 500 },
    );
  }
}
