// Types for the DEX Chat Interface
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  error?: {
    message: string;
    timestamp: Date;
    retryAttempts: number;
  };
  originalPayload?: {
    content: string;
    conversationContext?: {
      isWalletConnected: boolean;
      walletAddress?: string;
      previousMessages?: Array<{ role: string; content: string }>;
      messageCount?: number;
      hasTransactionData?: boolean;
    };
  };
  metadata?: {
    transactionData?: TransactionData;
    suggestedActions?: SuggestedAction[];
    confirmationRequired?: boolean;
    autoTriggerTransaction?: boolean;
    conversationCount?: number;
    guardrail?: GuardrailResult;
    lowConfidence?: boolean;
    clarificationQuestion?: string;
    requestStatus?: 'cancelled';
    status?: 'pending' | 'sent' | 'failed';
  };
}

// Chat session types for history
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastUpdated: Date;
  walletAddress?: string;
  pinned?: boolean;
  pinnedAt?: Date;
}

export interface ChatHistoryState {
  currentSessionId: string | null;
  sessions: ChatSession[];
}

export interface TransactionData {
  type: 'fiat_conversion';
  tokenIn?: string;
  amountIn?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  recipient?: string;
  transactionId?: string;
  txHash?: string; // Transaction hash for completed transactions
  receiptId?: string; // On-chain receipt ID (hex-encoded BytesN<32>)
  note?: string;
}

export interface TransactionHistoryEntry {
  id: string;
  kind: 'deposit' | 'payout' | 'risk_warning';
  status: 'pending' | 'completed' | 'warning' | 'failed' | 'cancelled';
  amount?: string;
  asset?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  note?: string;
  txHash?: string;
  reference?: string;
  message: string;
  createdAt: Date;
}

export interface SuggestedAction {
  id: string;
  type:
    | 'confirm_fiat'
    | 'connect_wallet'
    | 'approve_token'
    | 'check_portfolio'
    | 'market_rates'
    | 'learn_more'
    | 'cancel'
    | 'query';
  label: string;
  data?: Record<string, unknown>;
  priority?: boolean;
}

export type GuardrailCategory =
  | 'unsupported_request'
  | 'wallet_security'
  | 'compliance_evasion'
  | 'malicious_activity'
  | 'financial_guarantee';

export interface GuardrailResult {
  triggered: boolean;
  category: GuardrailCategory;
  reason: string;
  triggerCount?: number;
  totalTriggerCount?: number;
}

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance?: string;
  logoUrl?: string;
}

export interface UserPreferences {
  defaultSlippage: number;
  preferredTokens: string[];
  fiatCurrency: string;
  autoConfirmTransactions: boolean;
}

export interface AIAnalysisResult {
  intent:
    | 'fiat_conversion'
    | 'query'
    | 'portfolio'
    | 'technical_support'
    | 'guardrail'
    | 'unknown';
  confidence: number;
  extractedData: Partial<TransactionData>;
  requiredQuestions: string[];
  suggestedResponse: string;
  guardrail?: GuardrailResult;
}

// Paystack Types
export interface BankAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  transferCode?: string; // Paystack transfer code
}

export interface PaystackTransfer {
  amount: number;
  recipientCode: string;
  reason: string;
  reference: string;
}

// Admin Reconciliation Types
export interface ReconciliationRecord {
  id: string;
  depositTxHash: string;
  depositAmount: string;
  depositUser: string;
  depositDate: string;
  payoutId: string;
  payoutAmount: string;
  payoutRecipient: string;
  payoutStatus: 'pending' | 'completed' | 'failed' | 'warning' | 'cancelled';
  payoutDate: string;
  status: 'matched' | 'unmatched' | 'error';
}

export const ADMIN_AUDIT_ACTION_TYPES = [
  'withdrawal_approved',
  'withdrawal_rejected',
  'reconciliation_adjustment',
  'operator_added',
  'operator_removed',
  'bridge_paused',
  'bridge_unpaused',
] as const;

export type AdminAuditActionType = (typeof ADMIN_AUDIT_ACTION_TYPES)[number];

export type AdminAuditResult = 'success' | 'failed' | 'pending';

export interface AdminAuditLogEntry {
  id: string;
  timestamp: string;
  action: AdminAuditActionType;
  adminAddress: string;
  parameters: Record<string, string | number | boolean | null>;
  result: AdminAuditResult;
}

// Stellar Wallet
export interface StellarWalletConnection {
  address: string;
  publicKey: string;
  isConnected: boolean;
  network?: string;
  networkUrl?: string;
}

export interface FiatTransactionParams {
  token: string;
  amount: string;
  fiatAmount: string;
  transactionId: string;
  bankAccount?: BankAccount;
}

// Audit Logging Types
export interface AuditEntry {
  id: string;
  timestamp: Date;
  adminAddress: string;
  actionType: 'deposit' | 'payout' | 'reconciliation' | 'user_update' | 'settings_change';
  actionDescription: string;
  txHash?: string;
  metadata: Record<string, unknown>;
  status: 'success' | 'failed' | 'pending';
}

export interface AuditLogFilter {
  actionType?: AuditEntry['actionType'];
  adminAddress?: string;
  startDate?: Date;
  endDate?: Date;
  status?: AuditEntry['status'];
  txHash?: string;
}
// Filter Types for Transaction Views
export type TransactionStatus =
  | 'pending'
  | 'completed'
  | 'warning'
  | 'failed'
  | 'cancelled';

export type FilterCategory = 'status' | 'asset' | 'network';

export interface FilterState {
  status: TransactionStatus[];
  asset: string[];
  network: string[];
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface FilterStats {
  statusOptions: FilterOption[];
  assetOptions: FilterOption[];
  networkOptions: FilterOption[];
  totalCount: number;
  filteredCount: number;
}
