'use client';
import { v4 as uuidv4 } from 'uuid';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';
export type ToastSeverity = ToastVariant;

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  severity?: ToastSeverity;
  timestamp: number;
  durationMs?: number;
}

export type AppToast = Toast;

type ToastListener = (toasts: Toast[]) => void;

const toasts: Toast[] = [];
const listeners: Set<ToastListener> = new Set();

function notifyListeners(): void {
  listeners.forEach((listener) => listener([...toasts]));
}

export const toastStore = {
  addToast(input: string | { message: string; severity?: ToastSeverity; variant?: ToastVariant; durationMs?: number }, variant: ToastVariant = 'info'): string {
    let message: string;
    let resolvedVariant: ToastVariant;
    let durationMs: number | undefined;
    if (typeof input === 'string') {
      message = input;
      resolvedVariant = variant;
    } else {
      message = input.message;
      resolvedVariant = input.variant || (input.severity as ToastVariant) || variant;
      durationMs = input.durationMs;
    }
    const toast: Toast = { id: uuidv4(), message, variant: resolvedVariant, severity: resolvedVariant, timestamp: Date.now(), durationMs };
    toasts.push(toast);
    notifyListeners();
    if (durationMs) setTimeout(() => toastStore.removeToast(toast.id), durationMs);
    return toast.id;
  },
  removeToast(id: string): void {
    const index = toasts.findIndex((t) => t.id === id);
    if (index > -1) { toasts.splice(index, 1); notifyListeners(); }
  },
  dismissToast(id: string): void { this.removeToast(id); },
  subscribe(listener: ToastListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Toast[] { return [...toasts]; },
  getToasts(): Toast[] { return [...toasts]; },
  clearToasts(): void { toasts.length = 0; notifyListeners(); },
};
