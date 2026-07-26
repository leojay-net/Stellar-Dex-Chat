'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Automatic attempts made before the user has to press Retry themselves. */
export const MAX_AUTO_RETRIES = 3;

/** Delay before the first automatic retry. Doubles on each subsequent attempt. */
export const RETRY_BASE_DELAY_MS = 1000;

/**
 * Delay before automatic retry number `attempt`.
 *
 * Plain exponential backoff — 1s, 2s, 4s for attempts 1 through
 * {@link MAX_AUTO_RETRIES}. Deliberately jitter-free so the countdown shown in
 * the UI matches the wait exactly.
 *
 * @param attempt - One-based attempt number.
 * @returns Delay in milliseconds. Attempts below 1 are clamped to the base delay.
 */
export function getRetryDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.floor(attempt));
  return RETRY_BASE_DELAY_MS * 2 ** (normalized - 1);
}

/** Narrow a handler's return value without assuming it is a real `Promise`. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Arguments for {@link useMessageRetry}. */
export interface UseMessageRetryArgs {
  /** Id of the message being resent. */
  messageId: string;
  /**
   * Content to resend — the *original* text the user typed, so a retry never
   * loses or mangles the message.
   */
  content: string;
  /**
   * `true` while the message is in its failed state. Flipping this back to
   * `false` (the resend succeeded) cancels any pending automatic retry and
   * resets the attempt counter.
   */
  isFailed: boolean;
  /** Resend handler. Rejections are treated as another failure. */
  onRetry?: (messageId: string, content: string) => void | Promise<void>;
}

/** State returned by {@link useMessageRetry}. */
export interface UseMessageRetryState {
  /** Automatic attempts consumed so far, 0…{@link MAX_AUTO_RETRIES}. */
  attempts: number;
  /** `true` while a resend is in flight. */
  isRetrying: boolean;
  /**
   * Seconds remaining until the next automatic retry, or `null` when none is
   * scheduled (no handler, retries exhausted, or a resend is in flight).
   */
  secondsUntilNextRetry: number | null;
  /** `true` once the automatic budget is spent — only manual retries remain. */
  hasExhaustedAutoRetries: boolean;
  /** Resend immediately, cancelling any scheduled automatic attempt. */
  retryNow: () => void;
}

/**
 * Drive automatic resends of a failed chat message, with a manual escape hatch.
 *
 * While `isFailed` holds, up to {@link MAX_AUTO_RETRIES} resends are scheduled
 * on an exponential backoff ({@link getRetryDelayMs}). The countdown to the next
 * attempt is exposed so the UI can show it. Once the budget is spent the hook
 * goes quiet and {@link UseMessageRetryState.retryNow} — the Retry button — is
 * the only way forward.
 *
 * Manual retries do not consume the automatic budget: pressing Retry cancels the
 * pending timer, resends at once, and lets the remaining automatic attempts
 * resume if it fails again.
 *
 * @example
 * ```tsx
 * const retry = useMessageRetry({
 *   messageId: message.id,
 *   content: message.originalPayload?.content ?? message.content,
 *   isFailed: Boolean(message.error),
 *   onRetry,
 * });
 *
 * <button onClick={retry.retryNow} disabled={retry.isRetrying}>
 *   {retry.secondsUntilNextRetry !== null
 *     ? `Retrying in ${retry.secondsUntilNextRetry}s`
 *     : 'Retry'}
 * </button>
 * ```
 */
export function useMessageRetry({
  messageId,
  content,
  isFailed,
  onRetry,
}: UseMessageRetryArgs): UseMessageRetryState {
  const [attempts, setAttempts] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [secondsUntilNextRetry, setSecondsUntilNextRetry] = useState<
    number | null
  >(null);

  // Read through refs so a new inline `onRetry` (or edited content) never
  // restarts the backoff schedule mid-wait.
  const onRetryRef = useRef(onRetry);
  const contentRef = useRef(content);
  const messageIdRef = useRef(messageId);
  const isMountedRef = useRef(true);

  useEffect(() => {
    onRetryRef.current = onRetry;
    contentRef.current = content;
    messageIdRef.current = messageId;
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runRetry = useCallback(() => {
    const handler = onRetryRef.current;
    if (!handler) {
      return;
    }

    setNextRetryAt(null);
    setSecondsUntilNextRetry(null);
    setIsRetrying(true);

    const finish = () => {
      if (isMountedRef.current) {
        setIsRetrying(false);
      }
    };

    try {
      const result: unknown = handler(messageIdRef.current, contentRef.current);
      if (isPromiseLike(result)) {
        // A rejected resend is just another failure: clear the in-flight flag
        // so the next backoff step (or the manual button) can take over.
        result.then(finish, finish);
        return;
      }
    } catch {
      // Synchronous throw — same handling as a rejection.
    }
    finish();
  }, []);

  const retryNow = useCallback(() => {
    if (isRetrying) {
      return;
    }
    runRetry();
  }, [isRetrying, runRetry]);

  // Recovery: a message that is no longer failed gets a fresh budget, so a
  // later failure of the same message retries from the start.
  useEffect(() => {
    if (!isFailed) {
      setAttempts(0);
      setNextRetryAt(null);
      setSecondsUntilNextRetry(null);
    }
  }, [isFailed]);

  // Schedule the next automatic attempt.
  useEffect(() => {
    if (!isFailed || !onRetryRef.current || isRetrying) {
      return;
    }
    if (attempts >= MAX_AUTO_RETRIES) {
      return;
    }

    const delay = getRetryDelayMs(attempts + 1);
    setNextRetryAt(Date.now() + delay);

    const timer = setTimeout(() => {
      setAttempts((previous) => previous + 1);
      runRetry();
    }, delay);

    return () => clearTimeout(timer);
  }, [attempts, isFailed, isRetrying, runRetry]);

  // Tick the countdown that the UI renders.
  useEffect(() => {
    if (nextRetryAt === null) {
      setSecondsUntilNextRetry(null);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, nextRetryAt - Date.now());
      setSecondsUntilNextRetry(Math.ceil(remaining / 1000));
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [nextRetryAt]);

  return {
    attempts,
    isRetrying,
    secondsUntilNextRetry,
    hasExhaustedAutoRetries: attempts >= MAX_AUTO_RETRIES,
    retryNow,
  };
}
