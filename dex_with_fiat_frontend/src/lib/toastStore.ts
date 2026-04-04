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

export class ToastStore {
  private dedupeWindowMs: number;
  private defaultDurationMs: number;
  private generateId: () => string;
  private now: () => number;
  private toasts: Toast[] = [];
  private listeners: Set<(toasts: Toast[]) => void> = new Set();

  constructor(opts?: { dedupeWindowMs?: number; defaultDurationMs?: number; generateId?: () => string; now?: () => number }) {
    this.dedupeWindowMs = opts?.dedupeWindowMs ?? 0;
    this.defaultDurationMs = opts?.defaultDurationMs ?? 5000;
    this.generateId = opts?.generateId ?? (() => Math.random().toString(36).slice(2, 12));
    this.now = opts?.now ?? (() => Date.now());
  }

  addToast(input: string | { message: string; severity?: ToastSeverity; variant?: ToastVariant; durationMs?: number }, variant: ToastVariant = 'info'): string | null {
    const message = typeof input === 'string' ? input : input.message;
    const resolvedVariant: ToastVariant = typeof input === 'string' ? variant : (input.variant || input.severity as ToastVariant || variant);
    const now = this.now();
    if (this.dedupeWindowMs > 0) {
      const dupe = this.toasts.find(t => t.message === message && now - t.timestamp < this.dedupeWindowMs);
      if (dupe) return null;
    }
    const toast: Toast = { id: this.generateId(), message, variant: resolvedVariant, severity: resolvedVariant, timestamp: now };
    this.toasts.push(toast);
    this.notify();
    const duration = typeof input === 'object' ? input.durationMs : undefined;
    const ms = duration ?? this.defaultDurationMs;
    if (ms > 0) setTimeout(() => this.dismissToast(toast.id), ms);
    return toast.id;
  }

  dismissToast(id: string): void {
    const idx = this.toasts.findIndex(t => t.id === id);
    if (idx > -1) { this.toasts.splice(idx, 1); this.notify(); }
  }

  removeToast(id: string): void { this.dismissToast(id); }

  subscribe(listener: (toasts: Toast[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): Toast[] { return [...this.toasts]; }
  getToasts(): Toast[] { return [...this.toasts]; }
  clearToasts(): void { this.toasts = []; this.notify(); }

  private notify(): void { this.listeners.forEach(l => l([...this.toasts])); }
}
