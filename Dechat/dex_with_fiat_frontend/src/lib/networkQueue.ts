'use client';

import { toastStore } from './toastStore';

// Re-export for testing — spying on this object works across module boundaries.
export { toastStore as _toastStoreForTesting };

declare global {
  interface Window {
    __networkQueueListenerAdded?: boolean;
  }
}

type QueuedRequest = {
  id: number;
  name?: string;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  attempts: number;
};

const queue: QueuedRequest[] = [];
let nextId = 1;
let processing = false;
const listeners: Set<(count: number) => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn(queue.length));
}

const MAX_RETRY = 5;

function isNetworkError(error: unknown): boolean {
  if (typeof window !== 'undefined' && !window.navigator.onLine) {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('network request failed') ||
      msg.includes('networkerror') ||
      msg.includes('offline') ||
      msg.includes('timed out')
    );
  }
  return false;
}

async function processQueue(): Promise<void> {
  if (
    processing ||
    (typeof window !== 'undefined' && !window.navigator.onLine)
  ) {
    return;
  }
  processing = true;

  while (queue.length > 0) {
    const request = queue.shift();
    if (!request) break;
    notifyListeners();

    try {
      const result = await request.task();
      // Look up toastStore at call time to ensure mocks are respected in tests.
      const { toastStore: ts } = await import('./toastStore');
      ts.addToast('Message sent!', 'success');
      request.resolve(result as never);
    } catch (error) {
      if (request.attempts < MAX_RETRY && isNetworkError(error)) {
        request.attempts += 1;
        queue.push(request);
        notifyListeners();
        break;
      } else {
        const { toastStore: ts } = await import('./toastStore');
        ts.addToast('Could not send. Please try again.', 'error');
        request.reject(error);
      }
    }
  }

  processing = false;
}

if (typeof window !== 'undefined') {
  if (!window.__networkQueueListenerAdded) {
    window.addEventListener('online', () => {
      console.log('Network is back online; flushing read queue.');
      void processQueue();
    });
    window.__networkQueueListenerAdded = true;
  }
}

export function subscribeToQueue(fn: (count: number) => void) {
  listeners.add(fn);
  fn(queue.length);
  return () => {
    listeners.delete(fn);
  };
}

export { processQueue };

export function getQueuedReadRequestsCount(): number {
  return queue.length;
}

export function resetNetworkQueueForTests(): void {
  queue.length = 0;
  processing = false;
  notifyListeners();
}

export async function withNetworkReadQueue<T>(
  task: () => Promise<T>,
  name?: string,
): Promise<T> {
  const enqueue = (attempts: number, message: string) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      queue.push({
        id,
        name,
        task,
        resolve: (value: unknown) => resolve(value as T),
        reject,
        attempts,
      });
      notifyListeners();
      console.warn(`${message} [${name || id}].`);
    });

  if (typeof window !== 'undefined' && !window.navigator.onLine) {
    return enqueue(0, 'Queued offline read request');
  }

  try {
    return await task();
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return enqueue(1, 'Queued failed read request for retry');
  } finally {
    void processQueue();
  }
}
