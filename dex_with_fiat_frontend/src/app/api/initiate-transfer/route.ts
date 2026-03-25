import { NextRequest, NextResponse } from 'next/server';
import { getPayoutProvider } from '@/lib/payout/providers/registry';
import axios from 'axios';
import { telemetry } from '@/lib/telemetry';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';
import { env } from '@/lib/env';

const RATE_LIMIT = { maxRequests: 3, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/initiate-transfer', RATE_LIMIT);
  if (limited) return limited;

  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'initiate-transfer',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    telemetry.addLog(span.spanId, 'info', 'Starting transfer initiation', {
      endpoint: '/api/initiate-transfer',
    });

    const { source, reason, amount, recipient, reference } =
      await request.json();

    telemetry.addLog(span.spanId, 'info', 'Request parsed', {
      hasSource: !!source,
      hasAmount: !!amount,
      hasRecipient: !!recipient,
      amount: amount,
    });

    if (!source || !amount || !recipient) {
      telemetry.addLog(span.spanId, 'warn', 'Validation failed', {
        missingFields: {
          source: !source,
          amount: !amount,
          recipient: !recipient,
        },
      });
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'Missing required fields',
      });

      return NextResponse.json(
        {
          success: false,
          message: 'Source, amount, and recipient are required',
        },
        { status: 400 },
      );
    }

    const provider = getPayoutProvider();
    const data = await provider.initiateTransfer({
      source,
      reason,
      amount,
      recipient,
      reference,
    });

    return NextResponse.json({
      success: true,
      data,
    });
    if (!env.PAYSTACK_SECRET_KEY) {
      telemetry.addLog(
        span.spanId,
        'warn',
        'Using mock transfer (no API key)',
        { endpoint: '/api/initiate-transfer' },
      );

      // Mock transfer initiation when API key is missing
      const mockTransfer = {
        reference:
          reference ||
          `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        integration: 123456,
        domain: 'test',
        amount: amount,
        currency: 'NGN',
        source: source,
        reason: reason || 'Crypto withdrawal',
        recipient: recipient,
        status: 'pending',
        transfer_code: `TRF_${Math.random().toString(36).substr(2, 9)}`,
        id: Math.floor(Math.random() * 1000000),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await new Promise((resolve) => setTimeout(resolve, 1500));

      telemetry.addLog(span.spanId, 'info', 'Mock transfer completed', {
        transferReference: mockTransfer.reference,
        amount: amount,
      });
      telemetry.finishSpan(span.spanId, { success: true, mock: true });

      const response = NextResponse.json({
        success: true,
        data: mockTransfer,
      });

      telemetry.setTraceHeaders(response.headers, traceContext);
      return response;
    }

    // Call real Paystack API to initiate transfer
    telemetry.addLog(span.spanId, 'info', 'Calling Paystack API', {
      endpoint: 'https://api.paystack.co/transfer',
      amount: amount * 100,
      recipient: recipient,
    });

    const transferData = {
      source: source,
      amount: amount * 100, // Convert to kobo for Paystack
      recipient: recipient,
      reason: reason || 'Crypto withdrawal',
      reference:
        reference ||
        `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    const response = await axios.post(
      'https://api.paystack.co/transfer',
      transferData,
      {
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.data.status && response.data.data) {
      telemetry.addLog(span.spanId, 'info', 'Paystack transfer successful', {
        reference: response.data.data.reference,
        status: response.data.data.status,
      });
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
          message: response.data.message || 'Failed to initiate transfer',
        },
        { status: 400 },
      );
    }
  } catch (error: unknown) {
    telemetry.addLog(
      span.spanId,
      'error',
      'Unhandled error in transfer initiation',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );

    console.error('Initiate transfer error:', error);

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
      error: 'Failed to initiate transfer. Please try again.',
      errorType: 'unknown_error',
    });

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to initiate transfer. Please try again.',
      },
      { status: 500 },
    );
  }
}
