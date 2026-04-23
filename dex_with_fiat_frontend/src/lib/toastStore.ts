'use client';

import { v4 as uuidv4 } from 'uuid';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';
export type ToastSeverity = ToastVariant;

export interface AppToast {
  id: string;
  message: string;
  variant: ToastVariant;
  timestamp: number;
  duration?: number;
  durationMs?: number;
}

export interface AddToastOptions {
  message: string;
  severity?: string;
  variant?: ToastVariant;
  duration?: number;
  durationMs?: number;
}

type ToastListener = (toasts: AppToast[]) => void;

interface ToastStoreOptions {
  dedupeWindowMs?: number;
  defaultDurationMs?: number;
  now?: () => number;
  generateId?: () => string;
}

export class ToastStore {
  private toasts: AppToast[] = [];
  private listeners: Set<ToastListener> = new Set();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  
  private dedupeWindowMs: number;
  private defaultDurationMs: number;
  private now: () => number;
  private generateId: () => string;

  constructor(options: ToastStoreOptions = {}) {
    this.dedupeWindowMs = options.dedupeWindowMs ?? 2500;
    this.defaultDurationMs = options.defaultDurationMs ?? 5000;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? uuidv4;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener([...this.toasts]));
  }

  private mapSeverityToVariant(severity?: string): ToastVariant {
    if (!severity) return 'info';
    switch (severity.toLowerCase()) {
      case 'error': return 'error';
      case 'success': return 'success';
      case 'warning': return 'warning';
      case 'info':
      default:
        return 'info';
    }
  }

  /**
   * Add a toast notification
   */
  addToast(
    messageOrOptions: string | AddToastOptions,
    variantParam: ToastVariant = 'info'
  ): string | null {
    let message: string;
    let variant: ToastVariant;
    let duration = this.defaultDurationMs;

    if (typeof messageOrOptions === 'string') {
      message = messageOrOptions;
      variant = variantParam;
    } else {
      message = messageOrOptions.message;
      variant = messageOrOptions.variant || this.mapSeverityToVariant(messageOrOptions.severity);
      duration = messageOrOptions.duration ?? messageOrOptions.durationMs ?? this.defaultDurationMs;
    }

    // Deduplication logic
    const currentTime = this.now();
    const isDuplicate = this.toasts.some(
      (t) => 
        t.message === message && 
        t.variant === variant && 
        currentTime - t.timestamp < this.dedupeWindowMs
    );

    if (isDuplicate) {
      return null;
    }

    const id = this.generateId();
    const toast: AppToast = {
      id,
      message,
      variant,
      timestamp: currentTime,
      duration,
      durationMs: duration,
    };

    this.toasts.push(toast);
    
    if (duration > 0) {
      const timer = setTimeout(() => {
        this.dismissToast(id);
      }, duration);
      this.timers.set(id, timer);
    }

    this.notifyListeners();
    return id;
  }

  /**
   * Remove a toast by id (aliased as dismissToast)
   */
  removeToast(id: string): void {
    const index = this.toasts.findIndex((t) => t.id === id);
    if (index > -1) {
      this.toasts.splice(index, 1);
      
      const timer = this.timers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(id);
      }
      
      this.notifyListeners();
    }
  }

  dismissToast(id: string): void {
    this.removeToast(id);
  }

  /**
   * Subscribe to toast changes
   */
  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current toasts snapshot
   */
  getToasts(): AppToast[] {
    return [...this.toasts];
  }

  getSnapshot(): AppToast[] {
    return this.getToasts();
  }

  /**
   * Clear all toasts
   */
  clearToasts(): void {
    this.toasts.length = 0;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.notifyListeners();
  }
}

export const toastStore = new ToastStore();
