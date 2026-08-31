import { NextRequest, NextResponse } from 'next/server';
import { subscribeToPaymentStatus } from '@/lib/paymentStatusEvents';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';
import { paymentStatusStreamQuerySchema } from '@/lib/apiSchemas';

export const dynamic = 'force-dynamic';

// A single page legitimately opens a few of these long-lived SSE connections
// per session (one per hook) and the browser's EventSource auto-reconnects on
// every network blip, so the ceiling is generous — it only exists to stop a
// single IP from hammering the endpoint.
const RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/payment-status/stream', RATE_LIMIT);
  if (limited) return limited;

  const parsed = paymentStatusStreamQuerySchema.safeParse({
    sessionId: request.nextUrl.searchParams.get('sessionId') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: 'Validation failed',
        errors: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { sessionId } = parsed.data;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));

      unsubscribe = subscribeToPaymentStatus(sessionId, (event) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15_000);
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      unsubscribe?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
