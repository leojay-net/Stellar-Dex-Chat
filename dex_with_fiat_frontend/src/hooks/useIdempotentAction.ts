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
  const lastExecutionTime = useRef(0);
  const idempotencyKey = useRef<string>('');
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
        const result = await action(idempotencyKey.current);
        return result;
      } finally {
        isProcessingRef.current = false;
        if (isMountedRef.current) setIsProcessing(false);
      }
    },
    [cooldownMs, logSuppressed],
  );

  const reset = useCallback(() => {
    isProcessingRef.current = false;
    if (isMountedRef.current) setIsProcessing(false);
    lastExecutionTime.current = 0;
    idempotencyKey.current = '';
  }, []);

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
