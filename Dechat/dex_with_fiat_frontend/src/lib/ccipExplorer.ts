export const CCIP_POLL_INTERVAL_MS = 15_000;
export const CCIP_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface CCIPStatusResult {
  status: string;
  explorerUrl?: string;
  errorMessage?: string;
}

export interface CCIPTransferStartResult {
  transactionHash: string;
  explorerUrl?: string;
}

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  retries: 3,
  minDelayMs: 200,
  maxDelayMs: 5_000,
  factor: 2,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries, minDelayMs, maxDelayMs, factor } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const delayMs = Math.min(
        minDelayMs * Math.pow(factor, attempt),
        maxDelayMs,
      );
      await delay(delayMs);
      attempt += 1;
    }
  }

  throw lastError;
}

export async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  return retryWithBackoff(() => fetch(input, init), options);
}

export function buildCCIPExplorerTransactionUrl(
  transactionHash: string,
): string {
  return `https://ccip.chain.link/status?search=${encodeURIComponent(transactionHash)}`;
}
