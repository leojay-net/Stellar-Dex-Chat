import type { TransferStatusRecord } from '@/lib/transferStore';

export interface PaymentStatusEvent {
  reference: string;
  status: TransferStatusRecord['status'];
  updatedAt: string;
  amount?: number;
  failureReason?: string;
}

type PaymentStatusListener = (event: PaymentStatusEvent) => void;

const listenersBySession = new Map<string, Set<PaymentStatusListener>>();

export function subscribeToPaymentStatus(
  clientSessionId: string,
  listener: PaymentStatusListener,
) {
  const listeners = listenersBySession.get(clientSessionId) ?? new Set();
  listeners.add(listener);
  listenersBySession.set(clientSessionId, listeners);

  return () => {
    const current = listenersBySession.get(clientSessionId);
    if (!current) {
      return;
    }

    current.delete(listener);
    if (current.size === 0) {
      listenersBySession.delete(clientSessionId);
    }
  };
}

export function publishPaymentStatus(
  clientSessionId: string | undefined,
  event: PaymentStatusEvent,
) {
  if (!clientSessionId) {
    return;
  }

  const listeners = listenersBySession.get(clientSessionId);
  if (!listeners) {
    return;
  }

  listeners.forEach((listener) => listener(event));
}
