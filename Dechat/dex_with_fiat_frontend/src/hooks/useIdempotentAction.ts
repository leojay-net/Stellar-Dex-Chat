import { useCallback, useEffect, useRef, useState } from 'react';

export interface IdempotentActionOptions {
  cooldownMs?: number;
  logSuppressed?: boolean;
}

export interface IdempotentActionState {
  isProcessing: boolean;
  lastExecutionTime: number;
}

export function useIdempotentAction(options: IdempotentActionOptions = {}) {
  const { cooldownMs = 2000, logSuppressed = true } = options;

  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  // Initialize to -(cooldownMs) so the very first call is never throttled,
  // even when Date.now() returns 0 (e.g. with vi.useFakeTimers()).
  const lastExecutionTime = useRef(-(cooldownMs ?? 2000));
  const idempotencyKey = useRef<string>('');
  const inFlightActions = useRef(new Map<string, Promise<unknown>>());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async <T>(
      action: (idempotencyKey: string) => Promise<T>,
      actionName = 'action',
    ): Promise<T | null> => {
      const inFlightAction = inFlightActions.current.get(actionName);
      if (inFlightAction) {
        if (logSuppressed) {
          console.warn(
            `[useIdempotentAction] Suppressed duplicate ${actionName} attempt`,
            {
              actionName,
              isProcessing: isProcessingRef.current,
              deduped: true,
              timestamp: new Date().toISOString(),
            },
          );
        }
        return inFlightAction as Promise<T>;
      }

      const now = Date.now();
      const timeSinceLastExecution = now - lastExecutionTime.current;

      if (isProcessingRef.current || timeSinceLastExecution < cooldownMs) {
        if (logSuppressed) {
          console.warn(
            `[useIdempotentAction] Suppressed duplicate ${actionName} attempt`,
            {
              actionName,
              isProcessing: isProcessingRef.current,
              timeSinceLastExecution,
              cooldownMs,
              timestamp: new Date().toISOString(),
            },
          );
        }
        return null;
      }

      idempotencyKey.current = `${actionName}_${now}_${Math.random().toString(36).substring(2, 11)}`;
      isProcessingRef.current = true;
      if (isMountedRef.current) setIsProcessing(true);
      lastExecutionTime.current = now;

      try {
        const actionPromise = action(idempotencyKey.current);
        inFlightActions.current.set(actionName, actionPromise);
        return await actionPromise;
      } finally {
        inFlightActions.current.delete(actionName);
        isProcessingRef.current = false;
        if (isMountedRef.current) setIsProcessing(false);
      }
    },
    [cooldownMs, logSuppressed],
  );

  const reset = useCallback(() => {
    isProcessingRef.current = false;
    inFlightActions.current.clear();
    if (isMountedRef.current) setIsProcessing(false);
    lastExecutionTime.current = -(cooldownMs ?? 2000);
    idempotencyKey.current = '';
  }, [cooldownMs]);

  return {
    execute,
    reset,
    isProcessing,
    idempotencyKey: idempotencyKey.current,
    state: {
      isProcessing,
      lastExecutionTime: lastExecutionTime.current,
    } as IdempotentActionState,
  };
}
