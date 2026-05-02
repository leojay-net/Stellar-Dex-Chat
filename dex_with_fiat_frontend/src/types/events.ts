export interface ContractEvent {
  id: string;
  type: 'deposit' | 'withdraw';
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  actor: string;
  amount: string;
  token?: string;
  version: number;
}

export interface IndexerState {
  lastPagingToken: string;
  lastLedger: number;
  updatedAt: string;
}
