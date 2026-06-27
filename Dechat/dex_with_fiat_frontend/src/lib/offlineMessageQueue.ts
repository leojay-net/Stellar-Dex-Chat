'use client';

const DB_NAME = 'dechat-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'queued-messages';

export interface QueuedMessageRecord {
  id: string;
  content: string;
  optimisticUserId: string;
  pendingAssistantId: string;
  machineSnapshot: unknown;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addQueuedMessage(
  record: QueuedMessageRecord,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeQueuedMessage(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllQueuedMessages(): Promise<QueuedMessageRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QueuedMessageRecord[]);
    request.onerror = () => reject(request.error);
  });
}

type CountListener = (count: number) => void;
const countListeners: Set<CountListener> = new Set();
let currentCount = 0;

export function subscribeToQueuedMessageCount(
  listener: CountListener,
): () => void {
  countListeners.add(listener);
  listener(currentCount);
  return () => countListeners.delete(listener);
}

export function setQueuedMessageCount(count: number): void {
  currentCount = count;
  countListeners.forEach((listener) => listener(count));
}

export function getQueuedMessageCount(): number {
  return currentCount;
}
