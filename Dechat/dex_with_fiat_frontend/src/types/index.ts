// Types for the DEX Chat Interface

/**
 * A single message in a chat conversation.
 *
 * @example
 * ```ts
 * const msg: ChatMessage = {
 *   id: 'msg-001',
 *   role: 'user',
 *   content: 'Send 50 USDC to Alice',
 *   timestamp: new Date(),
 * };
 * ```
 */
export interface ChatMessage {
  /** Unique identifier for this message. */
  id: string;
  /** Who authored the message: the end-user, the AI assistant, or the system. */
  role: 'user' | 'assistant' | 'system';
  /** Plain-text (or markdown) body of the message. */
  content: string;
  /** Wall-clock time the message was created. */
  timestamp: Date;
  /**
   * Present when the message failed to send or process.
   *
   * @example `{ message: 'Network timeout', timestamp: new Date(), retryAttempts: 2 }`
   */
  error?: {
    /** Human-readable error description. */
    message: string;
    /** When the error occurred. */
    timestamp: Date;
    /** How many automatic retries have been attempted so far. */
    retryAttempts: number;
  };
  /**
   * Snapshot of the request payload that produced this message, retained for
   * debugging and retry purposes.
   */
  originalPayload?: {
    /** The raw message content that was submitted. */
    content: string;
    /** Wallet and session context captured at send time. */
    conversationContext?: {
      /** Whether a Stellar wallet was connected when the message was sent. */
      isWalletConnected: boolean;
      /** Connected wallet's Stellar public key (G…). */
      walletAddress?: string;
      /** Preceding messages included as context for the AI. */
      previousMessages?: Array<{ role: string; content: string }>;
      /** Total number of messages in the session at send time. */
      messageCount?: number;
      /** Whether any prior message in the session contained transaction data. */
      hasTransactionData?: boolean;
    };
  };
  /**
   * AI-enriched metadata attached after the assistant processes the message.
   */
  metadata?: {
    /** Structured transaction parameters extracted from the user's intent. */
    transactionData?: TransactionData;
    /** Quick-reply actions the UI should surface to the user. */
    suggestedActions?: SuggestedAction[];
    /** When `true`, the UI should ask the user to explicitly confirm before submitting the transaction. */
    confirmationRequired?: boolean;
    /** When `true`, the transaction should be submitted automatically without a confirmation prompt. */
    autoTriggerTransaction?: boolean;
    /** Running count of AI-processed messages in this session. */
    conversationCount?: number;
    /** Result from the content-safety guardrail check, if triggered. */
    guardrail?: GuardrailResult;
    /** When `true`, the AI's confidence score fell below the acceptable threshold. */
    lowConfidence?: boolean;
    /** A clarifying question the AI wants to ask the user before proceeding. */
    clarificationQuestion?: string;
    /** Set to `'cancelled'` when the user aborted the request mid-flight. */
    requestStatus?: 'cancelled';
    /** Delivery/processing status of this specific message. */
    status?: 'pending' | 'sent' | 'failed';
  };
}

/**
 * A persisted chat session containing its full message history.
 *
 * Sessions can be pinned so they appear at the top of the history list.
 *
 * @example
 * ```ts
 * const session: ChatSession = {
 *   id: 'sess-xyz',
 *   title: 'Send USDC to Alice',
 *   messages: [],
 *   createdAt: new Date(),
 *   lastUpdated: new Date(),
 * };
 * ```
 */
export interface ChatSession {
  /** Unique session identifier. */
  id: string;
  /** Short human-readable label, typically derived from the first user message. */
  title: string;
  /** Ordered list of messages belonging to this session. */
  messages: ChatMessage[];
  /** When the session was first created. */
  createdAt: Date;
  /** When the session was last modified (new message, rename, etc.). */
  lastUpdated: Date;
  /** Stellar wallet address associated with this session, if connected. */
  walletAddress?: string;
  /** Whether the session is pinned to the top of the history list. */
  pinned?: boolean;
  /** When the session was pinned. Only present when `pinned` is `true`. */
  pinnedAt?: Date;
}

/**
 * Top-level state shape for the chat history feature.
 *
 * Tracks which session is currently open and the full list of past sessions.
 */
export interface ChatHistoryState {
  /** ID of the session currently displayed in the chat pane, or `null` when none is open. */
  currentSessionId: string | null;
  /** All persisted sessions, ordered most-recent first. */
  sessions: ChatSession[];
}

/**
 * Parameters for a fiat conversion transaction initiated through the chat.
 *
 * Fields are optional because they are filled incrementally as the AI
 * extracts information from the conversation.
 *
 * @example
 * ```ts
 * const tx: TransactionData = {
 *   type: 'fiat_conversion',
 *   tokenIn: 'USDC',
 *   amountIn: '100',
 *   fiatAmount: '150',
 *   fiatCurrency: 'NGN',
 *   recipient: 'GABCDE…',
 * };
 * ```
 */
export interface TransactionData {
  /** Discriminant — currently only `'fiat_conversion'` is supported. */
  type: 'fiat_conversion';
  /** Symbol of the token being deposited (e.g. `'USDC'`). */
  tokenIn?: string;
  /** Amount of `tokenIn` to deposit, as a decimal string. */
  amountIn?: string;
  /** Equivalent fiat value, as a decimal string. */
  fiatAmount?: string;
  /** ISO 4217 currency code for the fiat side (e.g. `'NGN'`, `'USD'`). */
  fiatCurrency?: string;
  /** Stellar address (G…) of the fiat recipient. */
  recipient?: string;
  /** Operator-assigned transaction reference number. */
  transactionId?: string;
  /** On-chain transaction hash once the deposit has been confirmed. */
  txHash?: string;
  /**
   * On-chain receipt ID returned by the contract, hex-encoded `BytesN<32>`.
   *
   * @example `'a1b2c3d4…'`
   */
  receiptId?: string;
  /** Optional free-text note attached to the transaction. */
  note?: string;
}

/**
 * A single entry in the user-facing transaction history list.
 *
 * Combines deposit events, payout events, and risk warnings into a unified
 * timeline.
 */
export interface TransactionHistoryEntry {
  /** Unique identifier for this history entry. */
  id: string;
  /** Category of the event: a user deposit, an operator payout, or a risk notice. */
  kind: 'deposit' | 'payout' | 'risk_warning';
  /** Current processing status of the event. */
  status: 'pending' | 'completed' | 'warning' | 'failed' | 'cancelled';
  /** Token amount involved, as a decimal string. */
  amount?: string;
  /** Token symbol (e.g. `'USDC'`). */
  asset?: string;
  /** Fiat value, as a decimal string. */
  fiatAmount?: string;
  /** ISO 4217 currency code for the fiat side. */
  fiatCurrency?: string;
  /** Optional free-text note. */
  note?: string;
  /** On-chain transaction hash, once confirmed. */
  txHash?: string;
  /** Operator reference string associated with the deposit. */
  reference?: string;
  /** Human-readable description shown in the UI. */
  message: string;
  /** When this entry was created. */
  createdAt: Date;
}

/**
 * A quick-reply action card displayed below an assistant message.
 *
 * Actions let users respond to the AI with a single tap/click instead of
 * typing. The `data` field carries any parameters the handler needs.
 *
 * @example
 * ```ts
 * const action: SuggestedAction = {
 *   id: 'confirm-1',
 *   type: 'confirm_fiat',
 *   label: 'Confirm Transfer',
 *   priority: true,
 * };
 * ```
 */
export interface SuggestedAction {
  /** Unique identifier for this action within the message. */
  id: string;
  /**
   * Semantic type that determines how the UI handles the action:
   * - `confirm_fiat`     — user confirms a fiat conversion
   * - `connect_wallet`  — user is prompted to connect their Stellar wallet
   * - `approve_token`   — user approves a token allowance
   * - `check_portfolio` — opens the portfolio view
   * - `market_rates`    — shows current exchange rates
   * - `learn_more`      — opens contextual help content
   * - `cancel`          — cancels the current in-progress flow
   * - `query`           — sends a free-form follow-up query
   */
  type:
    | 'confirm_fiat'
    | 'connect_wallet'
    | 'approve_token'
    | 'check_portfolio'
    | 'market_rates'
    | 'learn_more'
    | 'cancel'
    | 'query';
  /** Button label shown in the UI. */
  label: string;
  /** Arbitrary key-value data passed to the action handler. */
  data?: Record<string, unknown>;
  /** When `true`, this action is visually highlighted as the recommended choice. */
  priority?: boolean;
}

/**
 * Categories of content-safety violations the guardrail system can detect.
 *
 * - `unsupported_request`   — the user asked for something outside the app's scope
 * - `wallet_security`       — potential wallet compromise or phishing attempt
 * - `compliance_evasion`    — attempt to circumvent KYC / AML controls
 * - `malicious_activity`    — detected fraudulent or harmful intent
 * - `financial_guarantee`   — request for guaranteed returns or yield promises
 */
export type GuardrailCategory =
  | 'unsupported_request'
  | 'wallet_security'
  | 'compliance_evasion'
  | 'malicious_activity'
  | 'financial_guarantee';

/**
 * Result returned by the content-safety guardrail pipeline.
 *
 * When `triggered` is `true` the message was blocked and the UI should display
 * a warning instead of executing the request.
 *
 * @example
 * ```ts
 * const result: GuardrailResult = {
 *   triggered: true,
 *   category: 'wallet_security',
 *   reason: 'Message contained a suspicious seed phrase request.',
 * };
 * ```
 */
export interface GuardrailResult {
  /** Whether the guardrail fired for this message. */
  triggered: boolean;
  /** Which safety category was matched. */
  category: GuardrailCategory;
  /** Human-readable explanation of why the guardrail was triggered. */
  reason: string;
  /** Number of times this category has been triggered in the current session. */
  triggerCount?: number;
  /** Cumulative trigger count across all categories in the current session. */
  totalTriggerCount?: number;
}

/**
 * A token available for trading or depositing on the DEX.
 *
 * @example
 * ```ts
 * const token: Token = {
 *   address: 'CABCDE…',
 *   symbol: 'USDC',
 *   name: 'USD Coin',
 *   decimals: 7,
 *   balance: '250.0000000',
 * };
 * ```
 */
export interface Token {
  /** Stellar contract address of the token. */
  address: string;
  /** Short ticker symbol (e.g. `'USDC'`, `'XLM'`). */
  symbol: string;
  /** Full display name of the token. */
  name: string;
  /** Number of decimal places used by the token contract. Stellar native assets use 7. */
  decimals: number;
  /** User's current balance as a decimal string, if available. */
  balance?: string;
  /** URL of the token's logo image. */
  logoUrl?: string;
}

/**
 * Persisted per-user UI and trading preferences.
 *
 * @example
 * ```ts
 * const prefs: UserPreferences = {
 *   defaultSlippage: 50,       // 0.5 %
 *   preferredTokens: ['USDC'],
 *   fiatCurrency: 'NGN',
 *   autoConfirmTransactions: false,
 * };
 * ```
 */
export interface UserPreferences {
  /**
   * Default slippage tolerance in basis points (1 bp = 0.01 %).
   *
   * @example `50` means 0.50 % slippage tolerance
   */
  defaultSlippage: number;
  /** Token symbols the user has marked as favourites. */
  preferredTokens: string[];
  /** ISO 4217 code for the user's preferred fiat currency. */
  fiatCurrency: string;
  /** When `true`, transactions are submitted automatically without a confirmation step. */
  autoConfirmTransactions: boolean;
}

/**
 * Structured output produced by the AI intent-classification pipeline.
 *
 * The AI parses each user message and returns this object so the application
 * layer can decide what action to take next.
 *
 * @example
 * ```ts
 * const result: AIAnalysisResult = {
 *   intent: 'fiat_conversion',
 *   confidence: 0.93,
 *   extractedData: { tokenIn: 'USDC', amountIn: '100' },
 *   requiredQuestions: ['What is the recipient address?'],
 *   suggestedResponse: 'I can help with that. Who should receive the funds?',
 * };
 * ```
 */
export interface AIAnalysisResult {
  /**
   * Top-level intent category identified by the AI:
   * - `fiat_conversion`    — user wants to convert crypto to fiat
   * - `query`              — informational question, no transaction needed
   * - `portfolio`          — user wants to view balances or history
   * - `technical_support`  — user needs help using the app
   * - `guardrail`          — message was flagged by the safety pipeline
   * - `unknown`            — intent could not be determined
   */
  intent:
    | 'fiat_conversion'
    | 'query'
    | 'portfolio'
    | 'technical_support'
    | 'guardrail'
    | 'unknown';
  /**
   * Confidence score between `0` (no confidence) and `1` (certain).
   *
   * @example `0.87`
   */
  confidence: number;
  /** Transaction fields the AI successfully extracted from the message. */
  extractedData: Partial<TransactionData>;
  /** Questions the AI needs answered before the transaction can proceed. */
  requiredQuestions: string[];
  /** Suggested reply text the UI can display to the user. */
  suggestedResponse: string;
  /** Populated when the guardrail pipeline triggered. */
  guardrail?: GuardrailResult;
}

// Paystack Types

/**
 * Nigerian bank account details used for Paystack payouts.
 *
 * @example
 * ```ts
 * const account: BankAccount = {
 *   bankCode: '058',
 *   bankName: 'GTBank',
 *   accountNumber: '0123456789',
 *   accountName: 'John Doe',
 * };
 * ```
 */
export interface BankAccount {
  /** Paystack / CBN bank code (e.g. `'058'` for GTBank). */
  bankCode: string;
  /** Human-readable bank name. */
  bankName: string;
  /** 10-digit NUBAN account number. */
  accountNumber: string;
  /** Account holder's name as registered with the bank. */
  accountName: string;
  /**
   * Paystack transfer recipient code, created via the Recipients API.
   *
   * @example `'RCP_1234abcd'`
   */
  transferCode?: string;
}

/**
 * Payload for initiating a Paystack transfer to a recipient.
 *
 * @example
 * ```ts
 * const transfer: PaystackTransfer = {
 *   amount: 5000,             // in kobo (NGN × 100)
 *   recipientCode: 'RCP_xyz',
 *   reason: 'DEX payout',
 *   reference: 'ref-20240101-001',
 * };
 * ```
 */
export interface PaystackTransfer {
  /** Transfer amount in the smallest currency unit (e.g. kobo for NGN). */
  amount: number;
  /** Paystack recipient code identifying the destination bank account. */
  recipientCode: string;
  /** Human-readable reason shown on the recipient's bank statement. */
  reason: string;
  /** Unique reference string for idempotency and reconciliation. */
  reference: string;
}

// Admin Reconciliation Types

/**
 * A matched (or unmatched) record linking an on-chain deposit to an
 * operator-side fiat payout.
 *
 * Used by the admin reconciliation dashboard to detect discrepancies.
 *
 * @example
 * ```ts
 * const record: ReconciliationRecord = {
 *   id: 'recon-001',
 *   depositTxHash: '0xabc…',
 *   depositAmount: '100',
 *   depositUser: 'GABCDE…',
 *   depositDate: '2024-01-01T12:00:00Z',
 *   payoutId: 'pay-001',
 *   payoutAmount: '100',
 *   payoutRecipient: '0123456789',
 *   payoutStatus: 'completed',
 *   payoutDate: '2024-01-01T12:05:00Z',
 *   status: 'matched',
 * };
 * ```
 */
export interface ReconciliationRecord {
  /** Unique identifier for this reconciliation record. */
  id: string;
  /** On-chain transaction hash of the deposit. */
  depositTxHash: string;
  /** Deposited token amount as a decimal string. */
  depositAmount: string;
  /** Stellar address of the depositor. */
  depositUser: string;
  /** ISO 8601 timestamp of the deposit. */
  depositDate: string;
  /** Operator-assigned payout identifier. */
  payoutId: string;
  /** Fiat amount paid out, as a decimal string. */
  payoutAmount: string;
  /** Bank account number or identifier of the payout recipient. */
  payoutRecipient: string;
  /** Current status of the payout leg. */
  payoutStatus: 'pending' | 'completed' | 'failed' | 'warning' | 'cancelled';
  /** ISO 8601 timestamp of the payout. */
  payoutDate: string;
  /**
   * Overall reconciliation result:
   * - `matched`   — deposit and payout amounts agree
   * - `unmatched` — amounts differ or one side is missing
   * - `error`     — an error occurred during reconciliation
   */
  status: 'matched' | 'unmatched' | 'error';
}

/**
 * Exhaustive list of auditable admin action types.
 *
 * Used to constrain `AdminAuditLogEntry.action` to known values.
 */
export const ADMIN_AUDIT_ACTION_TYPES = [
  'withdrawal_approved',
  'withdrawal_rejected',
  'reconciliation_adjustment',
  'operator_added',
  'operator_removed',
  'bridge_paused',
  'bridge_unpaused',
] as const;

/** Union type derived from `ADMIN_AUDIT_ACTION_TYPES`. */
export type AdminAuditActionType = (typeof ADMIN_AUDIT_ACTION_TYPES)[number];

/** Outcome of an audited admin action. */
export type AdminAuditResult = 'success' | 'failed' | 'pending';

/**
 * A single entry in the admin audit log, recording a privileged action
 * performed by an operator.
 *
 * @example
 * ```ts
 * const entry: AdminAuditLogEntry = {
 *   id: 'audit-001',
 *   timestamp: '2024-01-01T12:00:00Z',
 *   action: 'withdrawal_approved',
 *   adminAddress: 'GABCDE…',
 *   parameters: { amount: 100, token: 'USDC' },
 *   result: 'success',
 * };
 * ```
 */
export interface AdminAuditLogEntry {
  /** Unique identifier for this log entry. */
  id: string;
  /** ISO 8601 timestamp of when the action occurred. */
  timestamp: string;
  /** The type of admin action that was performed. */
  action: AdminAuditActionType;
  /** Stellar address of the admin who performed the action. */
  adminAddress: string;
  /** Arbitrary key-value parameters associated with the action. */
  parameters: Record<string, string | number | boolean | null>;
  /** Whether the action succeeded, failed, or is still pending. */
  result: AdminAuditResult;
}

// Stellar Wallet

/**
 * State of the user's connected Stellar wallet.
 *
 * @example
 * ```ts
 * const wallet: StellarWalletConnection = {
 *   address: 'GABCDE…',
 *   publicKey: 'GABCDE…',
 *   isConnected: true,
 *   network: 'mainnet',
 * };
 * ```
 */
export interface StellarWalletConnection {
  /** Stellar account address (G…). */
  address: string;
  /** Raw Ed25519 public key (identical to `address` for Stellar). */
  publicKey: string;
  /** Whether the wallet is currently connected. */
  isConnected: boolean;
  /** Network identifier, e.g. `'mainnet'`, `'testnet'`, or `'futurenet'`. */
  network?: string;
  /** RPC URL for the connected network. */
  networkUrl?: string;
}

/**
 * Parameters required to initiate a fiat conversion transaction.
 *
 * Passed from the chat flow to the transaction-submission layer.
 */
export interface FiatTransactionParams {
  /** Symbol of the token to deposit (e.g. `'USDC'`). */
  token: string;
  /** Token amount as a decimal string. */
  amount: string;
  /** Equivalent fiat value as a decimal string. */
  fiatAmount: string;
  /** Operator-assigned transaction reference. */
  transactionId: string;
  /** Destination bank account for the fiat payout. */
  bankAccount?: BankAccount;
}

// Audit Logging Types

/**
 * A general-purpose audit log entry for admin and system actions.
 *
 * Distinct from `AdminAuditLogEntry` in that it covers a broader set of
 * action types and uses `Date` objects instead of ISO strings.
 *
 * @example
 * ```ts
 * const entry: AuditEntry = {
 *   id: 'audit-002',
 *   timestamp: new Date(),
 *   adminAddress: 'GABCDE…',
 *   actionType: 'deposit',
 *   actionDescription: 'User deposited 100 USDC',
 *   status: 'success',
 *   metadata: {},
 * };
 * ```
 */
export interface AuditEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** When the action occurred. */
  timestamp: Date;
  /** Stellar address of the admin or operator who performed the action. */
  adminAddress: string;
  /**
   * High-level category of the action:
   * - `deposit`          — a user deposit event
   * - `payout`           — an operator fiat payout
   * - `reconciliation`   — a reconciliation adjustment
   * - `user_update`      — a user record change
   * - `settings_change`  — a system settings change
   */
  actionType: 'deposit' | 'payout' | 'reconciliation' | 'user_update' | 'settings_change';
  /** Free-text description of what was done. */
  actionDescription: string;
  /** On-chain transaction hash, if applicable. */
  txHash?: string;
  /** Additional contextual data about the action. */
  metadata: Record<string, unknown>;
  /** Outcome of the action. */
  status: 'success' | 'failed' | 'pending';
}

/**
 * Filter criteria for querying the audit log.
 *
 * All fields are optional; omitting a field means "no filter on that dimension".
 *
 * @example
 * ```ts
 * const filter: AuditLogFilter = {
 *   actionType: 'deposit',
 *   startDate: new Date('2024-01-01'),
 *   status: 'success',
 * };
 * ```
 */
export interface AuditLogFilter {
  /** Restrict results to a specific action category. */
  actionType?: AuditEntry['actionType'];
  /** Restrict results to actions performed by a specific admin address. */
  adminAddress?: string;
  /** Only return entries on or after this date. */
  startDate?: Date;
  /** Only return entries on or before this date. */
  endDate?: Date;
  /** Restrict results to a specific outcome status. */
  status?: AuditEntry['status'];
  /** Restrict results to entries linked to a specific on-chain transaction hash. */
  txHash?: string;
}

// Filter Types for Transaction Views

/**
 * Union of all valid transaction status values used in filter UI.
 */
export type TransactionStatus =
  | 'pending'
  | 'completed'
  | 'warning'
  | 'failed'
  | 'cancelled';

/**
 * Dimension along which transactions can be filtered.
 *
 * - `status`  — filter by processing status
 * - `asset`   — filter by token symbol
 * - `network` — filter by Stellar network
 */
export type FilterCategory = 'status' | 'asset' | 'network';

/**
 * Active filter selections across all filter dimensions.
 *
 * An empty array for a dimension means "show all" for that dimension.
 *
 * @example
 * ```ts
 * const state: FilterState = {
 *   status: ['pending', 'failed'],
 *   asset: ['USDC'],
 *   network: [],
 * };
 * ```
 */
export interface FilterState {
  /** Selected status values to include. */
  status: TransactionStatus[];
  /** Selected token symbols to include. */
  asset: string[];
  /** Selected network identifiers to include. */
  network: string[];
}

/**
 * A single option in a filter dropdown or chip group.
 *
 * @example `{ value: 'pending', label: 'Pending', count: 3 }`
 */
export interface FilterOption {
  /** Machine-readable value used to apply the filter. */
  value: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Number of transactions matching this option given the current data set. */
  count: number;
}

/**
 * Tailwind CSS class names applied to a filter chip based on its state.
 *
 * Separating chip and count class names allows independent styling of the
 * label and the badge counter.
 */
export interface FilterChipTone {
  /** Class names applied to the chip container element. */
  chipClassName: string;
  /** Class names applied to the count badge inside the chip. */
  countClassName: string;
}

/**
 * Aggregated statistics used to populate the filter panel.
 *
 * Pre-computed by the data layer so the UI doesn't need to iterate the full
 * transaction list on every render.
 *
 * @example
 * ```ts
 * const stats: FilterStats = {
 *   statusOptions: [{ value: 'pending', label: 'Pending', count: 5 }],
 *   assetOptions: [{ value: 'USDC', label: 'USDC', count: 12 }],
 *   networkOptions: [],
 *   totalCount: 17,
 *   filteredCount: 5,
 * };
 * ```
 */
export interface FilterStats {
  /** Available status filter options with counts. */
  statusOptions: FilterOption[];
  /** Available asset filter options with counts. */
  assetOptions: FilterOption[];
  /** Available network filter options with counts. */
  networkOptions: FilterOption[];
  /** Total number of transactions before any filters are applied. */
  totalCount: number;
  /** Number of transactions that match the current active filters. */
  filteredCount: number;
}
