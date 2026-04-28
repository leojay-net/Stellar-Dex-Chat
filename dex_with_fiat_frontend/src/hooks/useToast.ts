import { useSyncExternalStore, useCallback } from 'react';
import { AppToast, toastStore } from '@/lib/toastStore';

const EMPTY_ARRAY: AppToast[] = [];

export function useToast() {
  const getSnapshot = useCallback(() => toastStore.getSnapshot(), []);
  const toasts = useSyncExternalStore(
    (listener) => toastStore.subscribe(listener),
    getSnapshot,
    () => EMPTY_ARRAY,
  );

  return {
    toasts,
    addToast: toastStore.addToast.bind(toastStore),
    dismissToast: toastStore.dismissToast.bind(toastStore),
    clearToasts: toastStore.clearToasts.bind(toastStore),
  };
}
