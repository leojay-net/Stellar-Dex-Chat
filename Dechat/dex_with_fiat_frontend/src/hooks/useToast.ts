import { useSyncExternalStore, useCallback } from 'react';
import {
  AppToast,
  AddToastOptions,
  ToastVariant,
  toastStore,
} from '@/lib/toastStore';

const EMPTY_ARRAY: AppToast[] = [];

function dispatchToastTelemetry(
  event: string,
  detail?: Record<string, unknown>,
) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('toast_telemetry', { detail: { event, ...detail } }),
    );
  }
}

export function useToast() {
  const getSnapshot = useCallback(() => toastStore.getSnapshot(), []);
  const toasts = useSyncExternalStore(
    (listener) => toastStore.subscribe(listener),
    getSnapshot,
    () => EMPTY_ARRAY,
  );

  const addToast = useCallback(
    (
      messageOrOptions: string | AddToastOptions,
      variantParam?: ToastVariant,
    ): string | null => {
      const id = toastStore.addToast(messageOrOptions, variantParam);
      const message =
        typeof messageOrOptions === 'string'
          ? messageOrOptions
          : messageOrOptions.message;
      const variant =
        typeof messageOrOptions === 'string'
          ? (variantParam ?? 'info')
          : (messageOrOptions.variant ?? messageOrOptions.severity ?? 'info');
      dispatchToastTelemetry('toast_added', {
        id,
        message,
        variant,
        deduped: id === null,
      });
      return id;
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    toastStore.dismissToast(id);
    dispatchToastTelemetry('toast_dismissed', { id });
  }, []);

  const clearToasts = useCallback(() => {
    const count = toastStore.getSnapshot().length;
    toastStore.clearToasts();
    dispatchToastTelemetry('toasts_cleared', { count });
  }, []);

  return {
    toasts,
    addToast,
    dismissToast,
    clearToasts,
  };
}
