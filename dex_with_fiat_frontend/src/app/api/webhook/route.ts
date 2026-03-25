import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { telemetry } from '@/lib/telemetry';
import { env } from '@/lib/env';

export async function POST(request: NextRequest) {
  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'webhook-handler',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    telemetry.addLog(span.spanId, 'info', 'Starting webhook processing', {
      endpoint: '/api/webhook',
    });

    const payload = await request.text();
    const signature = request.headers.get('x-paystack-signature');

    telemetry.addLog(span.spanId, 'info', 'Webhook request parsed', {
      hasSignature: !!signature,
      payloadLength: payload.length,
    });

    if (!env.PAYSTACK_SECRET_KEY) {
      telemetry.addLog(
        span.spanId,
        'warn',
        'Skipping webhook verification (no API key)',
        { endpoint: '/api/webhook' },
      );
      console.warn(
        'Paystack secret key not found, skipping webhook verification',
      );

      const response = NextResponse.json({ received: true });
      telemetry.setTraceHeaders(response.headers, traceContext);
      return response;
    }

    if (!signature) {
      telemetry.addLog(span.spanId, 'warn', 'No signature provided', {
        endpoint: '/api/webhook',
      });
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'No signature provided',
      });

      return NextResponse.json(
        { message: 'No signature provided' },
        { status: 401 },
      );
    }

    // Verify signature
    telemetry.addLog(span.spanId, 'info', 'Verifying webhook signature', {
      endpoint: '/api/webhook',
    });

    const hash = crypto
      .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
      .update(payload)
      .digest('hex');

    if (hash !== signature) {
      telemetry.addLog(span.spanId, 'error', 'Invalid webhook signature', {
        expectedHash: hash,
        receivedSignature: signature,
      });
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'Invalid signature',
      });

      console.error('Invalid webhook signature');
      return NextResponse.json(
        { message: 'Invalid signature' },
        { status: 401 },
      );
    }

    const event = JSON.parse(payload);
    telemetry.addLog(span.spanId, 'info', 'Webhook signature verified', {
      eventType: event.event,
      reference: event.data?.reference,
    });

    console.log('Received Paystack webhook:', event.event);

    // Handle different event types
    switch (event.event) {
      case 'transfer.success':
        telemetry.addLog(span.spanId, 'info', 'Processing transfer success', {
          reference: event.data.reference,
          amount: event.data.amount,
          recipient: event.data.recipient,
          status: event.data.status,
        });
        console.log('Transfer successful:', {
          reference: event.data.reference,
          amount: event.data.amount,
          recipient: event.data.recipient,
          status: event.data.status,
        });
        // Here you would typically update your database
        // and potentially call the smart contract to confirm the transaction
        break;

      case 'transfer.failed':
        telemetry.addLog(span.spanId, 'warn', 'Processing transfer failure', {
          reference: event.data.reference,
          amount: event.data.amount,
          recipient: event.data.recipient,
          status: event.data.status,
          failureReason: event.data.failure_reason,
        });
        console.log('Transfer failed:', {
          reference: event.data.reference,
          amount: event.data.amount,
          recipient: event.data.recipient,
          status: event.data.status,
          failure_reason: event.data.failure_reason,
        });
        // Handle failed transfer - potentially trigger refund
        break;

      case 'transfer.reversed':
        telemetry.addLog(span.spanId, 'info', 'Processing transfer reversal', {
          reference: event.data.reference,
          amount: event.data.amount,
          recipient: event.data.recipient,
          status: event.data.status,
        });
        console.log('Transfer reversed:', {
          reference: event.data.reference,
          amount: event.data.amount,
          recipient: event.data.recipient,
          status: event.data.status,
        });
        // Handle reversed transfer
        break;

      default:
        telemetry.addLog(span.spanId, 'info', 'Unhandled webhook event', {
          eventType: event.event,
        });
        console.log('Unhandled webhook event:', event.event);
    }

    telemetry.addLog(span.spanId, 'info', 'Webhook processing completed', {
      eventType: event.event,
    });
    telemetry.finishSpan(span.spanId, { success: true });

    const response = NextResponse.json({ received: true });
    telemetry.setTraceHeaders(response.headers, traceContext);
    return response;
  } catch (error) {
    telemetry.addLog(span.spanId, 'error', 'Webhook processing error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    telemetry.finishSpan(span.spanId, {
      success: false,
      error: 'Webhook processing failed',
      errorType: 'processing_error',
    });

    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { message: 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
