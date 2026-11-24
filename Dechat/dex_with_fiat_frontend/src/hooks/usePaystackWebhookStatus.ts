'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/useToast';
import { getOrCreateClientSessionId } from '@/lib/clientSession';
import { chatTelemetry } from '@/lib/chatTelemetry';

interface PaymentStatusStreamEvent {
  reference: string;
  status: 'pending' | 'success' | 'failed' | 'reversed' | 'cancelled';
  updatedAt: string;
  amount?: number;
  failureReason?: string;
}

export function usePaystackWebhookStatus() {
  const { addToast } = useToast();

  // #1218: Hold addToast in a ref so the EventSource onmessage handler always
  // calls the latest version without needing addToast in the effect dependency
  // array. Without this, every render that produces a new addToast reference
  // would tear down and recreate the EventSource, causing a connection churn
  // and a brief period where both the old and new connections are open.
  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const clientSessionId = getOrCreateClientSessionId();
    if (!clientSessionId) {
      return;
    }

    const streamUrl = `/api/payment-status/stream?sessionId=${encodeURIComponent(
      clientSessionId,
    )}`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as PaymentStatusStreamEvent;
        chatTelemetry.paymentStatus({
          status: payload.status,
          reference: payload.reference,
          hasAmount: typeof payload.amount === 'number',
          hasFailureReason: Boolean(payload.failureReason),
        });
        if (payload.status === 'success') {
          addToastRef.current({
            message: 'Payment confirmed!',
            severity: 'success',
            durationMs: 5000,
          });
          return;
        }

        if (payload.status === 'failed' || payload.status === 'reversed') {
          addToastRef.current({
            message: 'Payment failed – please retry',
            severity: 'error',
            durationMs: 5000,
          });
        }
      } catch (error) {
        console.error('Failed to parse payment status event:', error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []); // EventSource is created once per mount; addToast is accessed via ref
}
