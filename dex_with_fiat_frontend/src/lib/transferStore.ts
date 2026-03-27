type ReplayCacheEntry = {
  seenAt: number;
};

const DEFAULT_REPLAY_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REPLAY_MAX_SIZE = 1000;

const replayCache = new Map<string, ReplayCacheEntry>();

function pruneReplayCache(now = Date.now()) {
  for (const [key, entry] of replayCache.entries()) {
    if (now - entry.seenAt > DEFAULT_REPLAY_TTL_MS) {
      replayCache.delete(key);
    }
  }

  while (replayCache.size > DEFAULT_REPLAY_MAX_SIZE) {
    const oldestKey = replayCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    replayCache.delete(oldestKey);
  }
}

export function isReplayEvent(cacheKey: string): boolean {
  const now = Date.now();
  pruneReplayCache(now);

  if (replayCache.has(cacheKey)) {
    return true;
  }

  replayCache.set(cacheKey, { seenAt: now });
  return false;
}

export function replayCacheStats() {
  return {
    size: replayCache.size,
    ttlMs: DEFAULT_REPLAY_TTL_MS,
    maxSize: DEFAULT_REPLAY_MAX_SIZE,
  };
}
/**
 * Simple in-memory store for transfer status tracking.
 * 
 * LIMITATION: This store is intentionally simple and resets on server restart 
 * as there is no persistent database connected for this stage. 
 * This is suitable for real-time status polling during a user session.
 */

export interface TransferStatusRecord {
    reference: string;
    status: 'pending' | 'success' | 'failed' | 'reversed';
    amount: number;
    failureReason?: string;
    updatedAt: string;
}

// Key is the transfer reference
export const transferStore = new Map<string, TransferStatusRecord>();
