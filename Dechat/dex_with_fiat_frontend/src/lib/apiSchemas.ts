import { z } from 'zod';

// Schema for create-recipient endpoint
export const createRecipientSchema = z.object({
  type: z.string().min(1, 'Type is required'),
  name: z.string().min(1, 'Name is required'),
  account_number: z.string().min(1, 'Account number is required'),
  bank_code: z.string().min(1, 'Bank code is required'),
  currency: z.string().min(1, 'Currency is required'),
});

export type CreateRecipientInput = z.infer<typeof createRecipientSchema>;

// Schema for initiate-transfer endpoint
export const initiateTransferSchema = z.object({
  source: z.string().min(1, 'Source is required'),
  reason: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  recipient: z.string().min(1, 'Recipient is required'),
  reference: z.string().optional(),
});

export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>;

// Schema for verify-account endpoint
export const verifyAccountSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required'),
  bankCode: z.string().min(1, 'Bank code is required'),
});

export type VerifyAccountInput = z.infer<typeof verifyAccountSchema>;

/**
 * Error thrown by {@link fetchWithRetry} when the server answers with a
 * non-OK status.
 *
 * Carries the status and the original `Response` as typed fields so
 * {@link withRetry} can decide whether the status is retryable without
 * casting. Previously these were stapled onto a plain `Error` through `any`,
 * which left the status invisible to the retry check.
 */
export class HttpResponseError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** The original response, for callers that need headers or a body. */
  readonly response: Response;

  constructor(response: Response) {
    super(`HTTP ${response.status}: ${response.statusText}`);
    this.name = 'HttpResponseError';
    this.status = response.status;
    this.response = response;
  }
}

/**
 * Retry configuration for API requests with exponential backoff
 */
export interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatusCodes?: number[];
  retryableErrors?: (error: unknown) => boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryableErrors: (error: unknown) => {
    if (error instanceof TypeError) {
      // Network errors (e.g., "Failed to fetch")
      return true;
    }
    if (error instanceof DOMException && error.name === 'NetworkError') {
      return true;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('failed to fetch') ||
        message.includes('network') ||
        message.includes('load failed') ||
        message.includes('timeout')
      );
    }
    return false;
  },
};

/**
 * Calculate delay with exponential backoff and jitter
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
function calculateBackoffDelay(
  attempt: number,
  config: Required<RetryConfig>,
): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  
  // Add jitter (±25%) to avoid thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  
  // Cap at max delay
  return Math.min(config.maxDelayMs, exponentialDelay + jitter);
}

/**
 * Sleep for a specified duration
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @returns Result of the function
 * @throws Last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const mergedConfig: Required<RetryConfig> = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
    retryableStatusCodes: config.retryableStatusCodes ?? DEFAULT_RETRY_CONFIG.retryableStatusCodes,
    retryableErrors: config.retryableErrors ?? DEFAULT_RETRY_CONFIG.retryableErrors,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // An aborted request must never be retried, whatever the caller's
      // `retryableErrors` says — the caller asked us to stop.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      // Check if error is retryable
      const isRetryableError = mergedConfig.retryableErrors(error);
      const isRetryableStatus =
        (error instanceof HttpResponseError || error instanceof Response) &&
        mergedConfig.retryableStatusCodes.includes(error.status);

      if (!isRetryableError && !isRetryableStatus) {
        throw error; // Non-retryable error, throw immediately
      }

      // Don't wait after the last attempt
      if (attempt < mergedConfig.maxRetries) {
        const delay = calculateBackoffDelay(attempt, mergedConfig);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Execute a fetch request with retry logic and exponential backoff
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param config - Retry configuration
 * @returns Fetch response
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {},
): Promise<Response> {
  return withRetry(async () => {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      // Throw error to trigger retry for non-OK responses
      throw new HttpResponseError(response);
    }
    
    return response;
  }, config);
}
