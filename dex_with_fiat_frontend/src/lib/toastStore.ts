export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface AppToast {
  id: string;
  message: string;
  severity: ToastSeverity;
  createdAt: number;
}

export interface AddToastInput {
  message: string;
  severity?: ToastSeverity;
  durationMs?: number;
}

export interface ToastStoreOptions {
  dedupeWindowMs?: number;
  defaultDurationMs?: number;
  maxToasts?: number;
  now?: () => number;
  generateId?: () => string;
  setTimer?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timerId: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_DEDUPE_WINDOW_MS = 2500;
const DEFAULT_DURATION_MS = 5000;
const DEFAULT_MAX_TOASTS = 4;

export class ToastStore {
  private toasts: AppToast[] = [];
  private listeners: Set<() => void> = new Set();
  private readonly dedupeWindowMs: number;
  private readonly defaultDurationMs: number;
  private readonly maxToasts: number;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timerId: ReturnType<typeof setTimeout>) => void;

  private lastToastAtByKey: Map<string, number> = new Map();
  private dismissTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(options: ToastStoreOptions = {}) {
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.defaultDurationMs = options.defaultDurationMs ?? DEFAULT_DURATION_MS;
    this.maxToasts = options.maxToasts ?? DEFAULT_MAX_TOASTS;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private getDedupeKey(message: string, severity: ToastSeverity) {
    return `${severity}:${message.trim()}`;
  }

  private scheduleDismiss(id: string, durationMs: number) {
    if (durationMs <= 0) {
      return;
    }

    this.cancelScheduledDismiss(id);
    const timerId = this.setTimer(() => this.dismissToast(id), durationMs);
    this.dismissTimers.set(id, timerId);
  }

  private cancelScheduledDismiss(id: string) {
    const timerId = this.dismissTimers.get(id);
    if (!timerId) {
      return;
    }

    this.clearTimer(timerId);
    this.dismissTimers.delete(id);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot() {
    return this.toasts;
  }

  addToast({
    message,
    severity = 'info',
    durationMs = this.defaultDurationMs,
  }: AddToastInput): string | null {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return null;
    }

    const now = this.now();
    const dedupeKey = this.getDedupeKey(normalizedMessage, severity);
    const lastToastAt = this.lastToastAtByKey.get(dedupeKey);
    if (
      typeof lastToastAt === 'number' &&
      now - lastToastAt < this.dedupeWindowMs
    ) {
      return null;
    }

    this.lastToastAtByKey.set(dedupeKey, now);

    const id = this.generateId();
    const nextToast: AppToast = {
      id,
      message: normalizedMessage,
      severity,
      createdAt: now,
    };

    this.toasts = [nextToast, ...this.toasts].slice(0, this.maxToasts);
    this.emit();
    this.scheduleDismiss(id, durationMs);

    // Ensure dropped toasts do not keep dangling timeout handles.
    const activeIds = new Set(this.toasts.map((toast) => toast.id));
    this.dismissTimers.forEach((_timer, toastId) => {
      if (!activeIds.has(toastId)) {
        this.cancelScheduledDismiss(toastId);
      }
    });

    return id;
  }

  dismissToast(id: string) {
    this.cancelScheduledDismiss(id);
    const initialLength = this.toasts.length;
    this.toasts = this.toasts.filter((toast) => toast.id !== id);

    if (this.toasts.length !== initialLength) {
      this.emit();
    }
  }

  clearToasts() {
    this.dismissTimers.forEach((timerId) => this.clearTimer(timerId));
    this.dismissTimers.clear();
    this.toasts = [];
    this.emit();
  }
}

export const toastStore = new ToastStore();
