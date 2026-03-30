'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import { getOrCreateClientSessionId } from '@/lib/clientSession';

interface PaymentStatusStreamEvent {
  reference: string;
  status: 'pending' | 'success' | 'failed' | 'reversed' | 'cancelled';
  updatedAt: string;
  amount?: number;
  failureReason?: string;
}

export function usePaystackWebhookStatus() {
  const { addToast } = useToast();

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
        if (payload.status === 'success') {
          addToast({
            message: 'Payment confirmed!',
            severity: 'success',
            durationMs: 5000,
          });
          return;
        }

        if (payload.status === 'failed' || payload.status === 'reversed') {
          addToast({
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
  }, [addToast]);
}
