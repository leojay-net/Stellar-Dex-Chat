import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { telemetry } from '@/lib/telemetry';
import { isReplayEvent, replayCacheStats } from '@/lib/transferStore';
import { getTransferStatus, setTransferStatus } from '@/lib/transferStore';
import { env } from '@/lib/env';
import { publishPaymentStatus } from '@/lib/paymentStatusEvents';

export async function POST(request: NextRequest) {
  const traceContext = telemetry.extractTraceFromHeaders(request.headers);
  const span = telemetry.createSpan(
    'webhook-handler',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    const secretKey = env.PAYSTACK_SECRET_KEY;
    // Fail-closed: reject immediately if the secret key is not configured.
    // Never process a webhook without a verified signature.
    if (!secretKey) {
      telemetry.addLog(
        span.spanId,
        'error',
        'Webhook rejected: PAYSTACK_SECRET_KEY is not configured',
        { endpoint: '/api/webhook' },
      );
      telemetry.finishSpan(span.spanId, {
        success: false,
        error: 'Missing PAYSTACK_SECRET_KEY',
      });
      console.error('PAYSTACK_SECRET_KEY is not configured. Rejecting webhook.');
      return NextResponse.json(
        { message: 'Webhook processing is not configured' },
        { status: 400 },
      );
    }

    telemetry.addLog(span.spanId, 'info', 'Starting webhook processing', {
      endpoint: '/api/webhook',
    });

    const payload = await request.text();
    const signature = request.headers.get('x-paystack-signature');

    telemetry.addLog(span.spanId, 'info', 'Webhook request parsed', {
      hasSignature: !!signature,
      payloadLength: payload.length,
    });

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
      .createHmac('sha512', secretKey)
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
    const payloadHash = crypto
      .createHash('sha256')
      .update(payload)
      .digest('hex');
    const replayKey = String(
      event?.data?.id || event?.data?.reference || payloadHash,
    );

    if (isReplayEvent(replayKey)) {
      const cache = replayCacheStats();
      telemetry.addLog(
        span.spanId,
        'warn',
        'Webhook replay detected, ignoring event',
        {
          replayKey,
          eventType: event.event,
          cacheSize: cache.size,
          cacheTtlMs: cache.ttlMs,
          cacheMaxSize: cache.maxSize,
        },
      );
      console.warn('Webhook replay detected and ignored', {
        replayKey,
        eventType: event.event,
      });

      const response = NextResponse.json({ received: true, duplicate: true });
      telemetry.setTraceHeaders(response.headers, traceContext);
      return response;
    }

    telemetry.addLog(span.spanId, 'info', 'Webhook signature verified', {
      eventType: event.event,
      reference: event.data?.reference,
      replayKey,
    });

    console.log('Received Paystack webhook:', event.event);

    // Handle different event types
    switch (event.event) {
      case 'transfer.success': {
        const existingRecord = getTransferStatus(event.data.reference);
        const updatedAt = new Date().toISOString();
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
        const nextRecord = setTransferStatus({
          reference: event.data.reference,
          status: 'success',
          amount: event.data.amount,
          updatedAt,
          clientSessionId: existingRecord?.clientSessionId,
        });
        publishPaymentStatus(nextRecord.clientSessionId, {
          reference: nextRecord.reference,
          status: nextRecord.status,
          amount: nextRecord.amount,
          updatedAt,
        });
        break;
      }

      case 'transfer.failed': {
        const existingRecord = getTransferStatus(event.data.reference);
        const updatedAt = new Date().toISOString();
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
        const nextRecord = setTransferStatus({
          reference: event.data.reference,
          status: 'failed',
          amount: event.data.amount,
          failureReason: event.data.failure_reason,
          updatedAt,
          clientSessionId: existingRecord?.clientSessionId,
        });
        publishPaymentStatus(nextRecord.clientSessionId, {
          reference: nextRecord.reference,
          status: nextRecord.status,
          amount: nextRecord.amount,
          updatedAt,
          failureReason: nextRecord.failureReason,
        });
        break;
      }

      case 'transfer.reversed': {
        const existingRecord = getTransferStatus(event.data.reference);
        const updatedAt = new Date().toISOString();
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
        const nextRecord = setTransferStatus({
          reference: event.data.reference,
          status: 'reversed',
          amount: event.data.amount,
          updatedAt,
          clientSessionId: existingRecord?.clientSessionId,
        });
        publishPaymentStatus(nextRecord.clientSessionId, {
          reference: nextRecord.reference,
          status: nextRecord.status,
          amount: nextRecord.amount,
          updatedAt,
        });
        break;
      }

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
