'use client';

import { toastStore } from './toastStore';

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
      request.resolve(result as never);
      // Notify user of successful retry
      toastStore.addToast('Message sent!', 'success');
    } catch (error) {
      if (request.attempts < MAX_RETRY && isNetworkError(error)) {
        request.attempts += 1;
        queue.push(request);
        notifyListeners();
        break;
      } else {
        // Notify user of final failure
        toastStore.addToast('Could not send. Please try again.', 'error');
        request.reject(error);
      }
    }
  }

  processing = false;
}

if (typeof window !== 'undefined') {
  if (!(window as any).__networkQueueListenerAdded) {
    window.addEventListener('online', () => {
      console.log('Network is back online; flushing read queue.');
      void processQueue();
    });
    (window as any).__networkQueueListenerAdded = true;
  }
}

export function subscribeToQueue(fn: (count: number) => void) {
  listeners.add(fn);
  fn(queue.length);
  return () => listeners.delete(fn);
}

export { processQueue };

export function getQueuedReadRequestsCount(): number {
  return queue.length;
}

export function withNetworkReadQueue<T>(
  task: () => Promise<T>,
  name?: string,
): Promise<T> {
  return new Promise<T>(async (resolve, reject) => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      const id = nextId++;
      queue.push({
        id,
        name,
        task,
        resolve: (value: unknown) => resolve(value as T),
        reject,
        attempts: 0,
      });
      notifyListeners();
      console.warn(`Queued read request [${name || id}] until online.`);
      return;
    }

    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      if (isNetworkError(error)) {
        const id = nextId++;
        queue.push({
          id,
          name,
          task,
          resolve: (value: unknown) => resolve(value as T),
          reject,
          attempts: 1,
        });
        notifyListeners();
        console.warn(
          `Network read failed, queued request [${name || id}] for retry.`,
        );
      } else {
        reject(error);
      }
    } finally {
      void processQueue();
    }
  });
}
