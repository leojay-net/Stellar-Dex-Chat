import { ReconciliationRecord } from '@/types';

export interface DailyMetric {
  date: string;
  volume: number;
  count: number;
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000ms) */
  initialDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay between retries in milliseconds (default: 30000ms) */
  maxDelay?: number;
  /** Whether to retry on specific HTTP status codes (default: retry on 5xx) */
  retryableStatuses?: number[];
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  data: T;
  attemptCount: number;
  totalDelay: number;
}

/**
 * Execute an async function with exponential backoff retry logic.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise with the result and retry metadata
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch('/api/data').then(r => r.json()),
 *   { maxRetries: 5, initialDelay: 2000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffMultiplier = 2,
    maxDelay = 30000,
    retryableStatuses = [500, 502, 503, 504],
    isRetryable: customIsRetryable,
  } = options;

  let attemptCount = 0;
  let totalDelay = 0;
  let lastError: unknown;

  while (attemptCount <= maxRetries) {
    try {
      const data = await fn();
      return { data, attemptCount, totalDelay };
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      const shouldRetry = customIsRetryable
        ? customIsRetryable(error)
        : isDefaultRetryable(error, retryableStatuses);

      if (!shouldRetry || attemptCount >= maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attemptCount),
        maxDelay,
      );

      totalDelay += delay;
      attemptCount++;

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Default retry logic: retry on HTTP 5xx errors or network errors.
 */
function isDefaultRetryable(error: unknown, retryableStatuses: number[]): boolean {
  // Check for Response errors (HTTP status codes)
  if (error instanceof Response) {
    return retryableStatuses.includes(error.status);
  }

  // Check for Error objects with status property (like fetch errors)
  if (error instanceof Error) {
    const errorWithStatus = error as { status?: number };
    if (errorWithStatus.status !== undefined) {
      return retryableStatuses.includes(errorWithStatus.status);
    }

    // Retry on network errors (no status code)
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }
  }

  return false;
}

export function aggregateDailyVolume(
  records: ReconciliationRecord[],
  days: number = 30,
): DailyMetric[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const metricsMap = new Map<string, DailyMetric>();

  // Initialize the last `days` safely
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    metricsMap.set(dateStr, { date: dateStr, volume: 0, count: 0 });
  }

  records.forEach((record) => {
    if (!record.depositDate) return;

    try {
      const parsedDate = new Date(record.depositDate);
      if (isNaN(parsedDate.getTime())) return;

      const dateStr = parsedDate.toISOString().split('T')[0];
      const metric = metricsMap.get(dateStr);

      if (metric) {
        metric.volume += parseFloat(record.depositAmount || '0');
        metric.count += 1;
      }
    } catch {
      // Ignored invalid dates
    }
  });

  return Array.from(metricsMap.values());
}
