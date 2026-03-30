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

export function buildCCIPExplorerTransactionUrl(
  transactionHash: string,
): string {
  return `https://ccip.chain.link/status?search=${encodeURIComponent(transactionHash)}`;
}
