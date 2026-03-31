import { useCallback, useRef, useState } from 'react';

export interface IdempotentActionOptions {
  cooldownMs?: number;
  logSuppressed?: boolean;
}

export interface IdempotentActionState {
  isProcessing: boolean;
  lastExecutionTime: number;
}

/**
 * Hook to prevent accidental double-submit actions with idempotency guarantees.
 * 
 * Features:
 * - Prevents duplicate submissions during cooldown period
 * - Tracks processing state for UI feedback
 * - Logs suppressed duplicate attempts for diagnostics
 * - Generates unique idempotency keys per action
 */
export function useIdempotentAction(options: IdempotentActionOptions = {}) {
  const { cooldownMs = 2000, logSuppressed = true } = options;
  
  const [isProcessing, setIsProcessing] = useState(false);
  const lastExecutionTime = useRef(0);
  const idempotencyKey = useRef<string>('');

  const execute = useCallback(
    async <T>(
      action: (idempotencyKey: string) => Promise<T>,
      actionName = 'action'
    ): Promise<T | null> => {
      const now = Date.now();
      const timeSinceLastExecution = now - lastExecutionTime.current;

      // Check if we're still in cooldown period
      if (isProcessing || timeSinceLastExecution < cooldownMs) {
        if (logSuppressed) {
          console.warn(
            `[useIdempotentAction] Suppressed duplicate ${actionName} attempt`,
            {
              actionName,
              isProcessing,
              timeSinceLastExecution,
              cooldownMs,
              timestamp: new Date().toISOString(),
            }
          );
        }
        return null;
      }

      // Generate new idempotency key for this action
      idempotencyKey.current = `${actionName}_${now}_${Math.random().toString(36).substring(2, 11)}`;
      
      setIsProcessing(true);
      lastExecutionTime.current = now;

      try {
        const result = await action(idempotencyKey.current);
        return result;
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, cooldownMs, logSuppressed]
  );

  const reset = useCallback(() => {
    setIsProcessing(false);
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
