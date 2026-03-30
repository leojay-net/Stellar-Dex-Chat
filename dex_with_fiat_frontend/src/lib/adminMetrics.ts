import { ReconciliationRecord } from '../types';

export interface AdminMetrics {
  bridgeBalance: bigint | null;
  totalDeposited: bigint | null;
  pendingPayouts: number;
  failedPayouts: number;
}

/**
 * Aggregates payout status metrics from reconciliation records
 */
export function aggregatePayoutMetrics(records: ReconciliationRecord[]) {
  return {
    pendingPayouts: records.filter(r => r.payoutStatus === 'pending' || r.status === 'unmatched').length,
    failedPayouts: records.filter(r => r.payoutStatus === 'failed' || r.status === 'error').length,
  };
}

/**
 * Hook or helper could be added here if needed, 
 * but for now we'll use base logic in the components.
 */
