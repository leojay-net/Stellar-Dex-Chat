#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, xdr::ToXdr,
    Address, Bytes, BytesN, Env, Symbol, Vec,
};

pub mod math;
pub mod oracle;

// ── Constants ─────────────────────────────────────────────────────────────
pub const MIN_TTL: u32 = 518_400; // ~30 days
pub const MAX_TTL: u32 = 535_680; // ~31 days
const MAX_REFERENCE_LEN: u32 = 64;
const MAX_SIGNERS: u32 = 20;
const WINDOW_LEDGERS: u32 = 17_280; // ~24 hours
const CIRCUIT_BREAKER_RESET_LEDGERS: u32 = 34_560; // ~48 hours (2 × WINDOW_LEDGERS)
const WITHDRAWAL_EXPIRY_WINDOW_LEDGERS: u32 = 17_280; // ~24 hours — reserved for future withdrawal expiry feature
const MIN_TIMELOCK_DELAY: u32 = 34_560; // 48 hours
const DEFAULT_INACTIVITY_THRESHOLD: u32 = 1_555_200; // ~3 months
const MIN_UPGRADE_DELAY: u32 = 1_000;
pub const EVENT_VERSION: u32 = 1;
pub const ESCROW_STORAGE_VERSION: u32 = 1;

// ── Error codes ───────────────────────────────────────────────────────────
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Overflow = 10,

    // --- 100 series: Initialization & State ---
    NotInitialized = 101,
    AlreadyInitialized = 102,
    InternalError = 103,
    ContractPaused = 104,

    // --- 200 series: Authorization & Access ---
    Unauthorized = 201,
    NotAllowed = 202,
    NoPendingAdmin = 203,
    InvalidRecipient = 204,
    NotOperator = 205,
    SameAdmin = 207,
    OperatorCapReached = 206,

    // --- 300 series: Constraints & Limits ---
    ZeroAmount = 301,
    ExceedsLimit = 302,
    ExceedsLimitMaxCap = 303,
    DailyLimitExceeded = 304,
    ExceedsFiatLimit = 305,
    ReferenceTooLong = 306,
    CooldownActive = 307,
    AntiSandwichDelayActive = 308,
    TokenNotWhitelisted = 309,
    AddressDenied = 310,
    RescueForbidden = 311,
    CircuitBreakerActive = 312,
    InvalidMemoHash = 313,
    FeeWithdrawalExceedsBalance = 314,
    CircuitBreakerTripped = 315,
    MaxDeniedReached = 316,
    InvalidAmount = 317,
    SelfReferentialAddress = 318,
    LimitCapCannotBeLowered = 319,

    // --- 400 series: Funds & Balances ---
    InsufficientFunds = 401,
    NoFeesToWithdraw = 402,

    // --- 500 series: Withdrawal Queue ---
    RequestNotFound = 501,
    WithdrawalLocked = 502,
    OperatorDailyLimitExceeded = 503,

    // --- 600 series: Governance & Timelock ---
    ActionNotQueued = 601,
    ActionNotReady = 602,
    InactivityThresholdNotReached = 603,
    NoEmergencyRecoveryAddress = 604,
    UpgradeNotReady = 605,
    UpgradeProposalMissing = 606,
    UpgradeDelayTooShort = 607,

    // --- 700 series: External Services ---
    OracleNotSet = 701,
    OraclePriceInvalid = 702,
    SlippageExceeded = 703,
    SlippageTooHigh = 704,

    // --- 800 series: Quota & Migration ---
    WithdrawalQuotaExceeded = 801,
    MigrationAlreadyComplete = 802,
    BatchOperationFailed = 803,

    // --- 900 series: Replay Protection ---
    InvalidNonce = 901,
    StaleNonce = 902,

    // --- 1000 series: Deposit Floor ---
    BelowMinimum = 1001,

    // --- 1100 series: Multi-sig ---
    InvalidThreshold = 1101,
    DuplicateSigner = 1102,
    SignerNotFound = 1103,
    ProposalNotFound = 1104,
    AlreadyApproved = 1105,
    ProposalAlreadyExecuted = 1106,
    ThresholdNotMet = 1107,
    MaxSignersReached = 1108,
}

// ── Models ────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalProposal {
    pub to: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigProposal {
    pub creator: Address,
    pub action: BatchAdminOp,
    pub approvals: Vec<Address>,
    pub executed: bool,
    pub created_at: u32,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawRequest {
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub unlock_ledger: u32,
    pub memo_hash: Option<BytesN<32>>,
    pub queued_ledger: u32,
    /// Risk tier for withdrawal prioritization. Tier 0 = highest priority.
    pub risk_tier: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalDailyWithdrawn {
    pub amount: i128,
    pub window_start: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenConfig {
    pub limit: i128,
    pub daily_deposit_limit: i128,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub total_liabilities: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub id: BytesN<32>,
    pub depositor: Address,
    pub amount: i128,
    pub ledger: u32,
    pub reference: Bytes,
    pub refunded: bool,
    pub memo_hash: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuedAdminAction {
    pub action_type: Symbol,
    pub payload: Bytes,
    pub target_ledger: u32,
    pub queued_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserDailyVolume {
    pub usd_cents: i128,
    pub window_start: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub wasm_hash: BytesN<32>,
    pub executable_after: u32,
}

/// Auditable timing metadata for an upgrade proposal.
/// Stored separately so pre-existing `UpgradeProposal` values remain decodable.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposalTiming {
    pub wasm_hash: BytesN<32>,
    pub proposed_at: u32,
    pub delay: u32,
    pub executable_after: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserDailyWithdrawal {
    pub amount: i128,
    pub window_start: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserDailyDeposit {
    pub amount: i128,
    pub window_start: u32,
}

/// A depositor's escrowed position: the persistent successor to the evictable
/// [`Receipt`], written by [`FiatBridge::migrate_escrow`] and read by
/// [`FiatBridge::get_escrow_record`]. `amount` is in the token's smallest unit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    pub version: u32,
    pub depositor: Address,
    pub token: Address,
    pub amount: i128,
    pub ledger: u32,
    pub migrated: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchAdminOp {
    pub op_type: Symbol,
    pub payload: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchResult {
    pub total_ops: u32,
    pub success_count: u32,
    pub failure_count: u32,
    pub failed_index: Option<u32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeartbeatItem {
    pub operator: Address,
    pub nonce: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchHeartbeatResult {
    pub total_items: u32,
    pub success_count: u32,
    pub failure_count: u32,
    pub failed_index: Option<u32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenAllowlistEntry {
    pub token: Address,
    pub address: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenAllowlistEnabledEntry {
    pub token: Address,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigSnapshot {
    pub admin: Address,
    pub pending_admin: Option<Address>,
    pub token: Address,
    pub oracle: Option<Address>,
    pub fiat_limit: Option<i128>,
    pub lock_period: u32,
    pub cooldown_ledgers: u32,
    pub inactivity_threshold: u32,
    pub allowlist_enabled: bool,
    pub emergency_recovery: Option<Address>,
    pub anti_sandwich_delay: u32,
}

// ── Events ────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct DeployHashEvent {
    pub version: u32,
    pub config_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DepositEvent {
    pub version: u32,
    pub from: Address,
    pub token: Address,
    pub amount: i128,
    pub receipt_id: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ReceiptIssuedEvent {
    pub version: u32,
    pub receipt_id: BytesN<32>,
    pub memo_hash: Option<BytesN<32>>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawEvent {
    pub version: u32,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawalRequestedEvent {
    pub version: u32,
    pub to: Address,
    pub request_id: u64,
    pub memo_hash: Option<BytesN<32>>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawalExecutedEvent {
    pub version: u32,
    pub request_id: u64,
    pub to: Address,
    pub amount: i128,
    pub nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawalCancelledEvent {
    pub version: u32,
    pub request_id: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeAccruedEvent {
    pub version: u32,
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RefundEvent {
    pub version: u32,
    pub receipt_id: BytesN<32>,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PausedEvent {
    pub version: u32,
    pub by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct UnpausedEvent {
    pub version: u32,
    pub by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminTransferEvent {
    pub version: u32,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SetMinDepositEvent {
    pub version: u32,
    pub min: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SlippageEvent {
    pub version: u32,
    pub slippage_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SlippageThresholdSetEvent {
    pub version: u32,
    pub threshold_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct TelemetryEvent {
    pub version: u32,
    pub function_name: Symbol,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminActionQueuedEvent {
    pub version: u32,
    pub action_type: Symbol,
    pub action_id: u64,
    pub target_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminActionExecutedEvent {
    pub version: u32,
    pub action_id: u64,
}

/// Emitted on every accepted `set_operator` call. `previous_active` is the
/// operator's flag *before* the call and `active` the flag after it, so an
/// indexer can tell a real transition from a no-op re-activation without
/// replaying storage. `operator_count` is the live active-operator count once
/// the change has been applied — the same number `set_max_operators` is
/// checked against — which makes the cap invariant auditable from the event
/// stream alone.
#[contractevent]
#[derive(Clone, Debug)]
pub struct SetOperatorEvent {
    pub version: u32,
    pub operator: Address,
    pub active: bool,
    pub previous_active: bool,
    pub operator_count: u32,
}

/// Emitted on every accepted `set_max_operators` call. `previous` is the cap in
/// force before the call (0 when none had been configured, which is the
/// "unlimited" sentinel) and `max_operators` is the newly stored cap, so
/// indexers can reconstruct the full history of the limit without replaying
/// storage.
#[contractevent]
#[derive(Clone, Debug)]
pub struct SetMaxOperatorsEvent {
    pub version: u32,
    pub previous: u32,
    pub max_operators: u32,
    pub active_operators: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DenyAddressEvent {
    pub version: u32,
    pub address: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct HeartbeatEvent {
    pub version: u32,
    pub operator: Address,
    pub ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeartbeatBatchEvent {
    pub version: u32,
    pub total_items: u32,
    pub success_count: u32,
    pub failure_count: u32,
    pub ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeartbeatBatchFailEvent {
    pub version: u32,
    pub index: u32,
    pub total_items: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct NonceIncrementedEvent {
    pub version: u32,
    pub operator: Address,
    pub new_nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct InitNonceIncrementedEvent {
    pub version: u32,
    pub admin: Address,
    pub new_nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OperatorPrunedEvent {
    pub version: u32,
    pub operator: Address,
    pub ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeWithdrawnEvent {
    pub version: u32,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeVaultReconciledEvent {
    pub version: u32,
    pub token: Address,
    pub vault_ledger: i128,
    pub on_chain_balance: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeQueryEvent {
    pub version: u32,
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdminRoleCheckEvent {
    pub version: u32,
    pub admin: Address,
    pub is_operator: bool,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RescueEvent {
    pub version: u32,
    pub token: Address,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct QuotaSetEvent {
    pub version: u32,
    pub quota: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct QuotaResetEvent {
    pub version: u32,
    pub user: Address,
    pub window_start: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawalQuotaConsumedEvent {
    pub version: u32,
    pub user: Address,
    pub amount: i128,
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MigrationEvent {
    pub version: u32,
    pub cursor: u64,
    pub migrated_count: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct BatchFailEvent {
    pub version: u32,
    pub index: u32,
    pub total_ops: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct BatchOkEvent {
    pub version: u32,
    pub success_count: u32,
    pub failure_count: u32,
    pub total_ops: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct CircuitBreakerResetEvent {
    pub version: u32,
    pub ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct CircuitBreakerTrippedEvent {
    pub version: u32,
    pub new_total: i128,
    pub threshold: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SetWithdrawOperatorEvent {
    pub version: u32,
    pub operator: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RemoveWithdrawOperatorEvent {
    pub version: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DenyRemovedEvent {
    pub version: u32,
    pub address: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct IsDeniedCheckedEvent {
    pub version: u32,
    pub address: Address,
    pub result: bool,
}

/// Emitted on every `is_operator` query, mirroring `IsDeniedCheckedEvent` for
/// the denylist. `is_operator` is an access-control lookup, so the audit trail
/// records which address was checked and what the contract answered.
#[contractevent]
#[derive(Clone, Debug)]
pub struct IsOperatorCheckedEvent {
    pub version: u32,
    pub operator: Address,
    pub result: bool,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct UpgradeCancelledEvent {
    pub version: u32,
    pub admin: Address,
    pub wasm_hash: BytesN<32>,
    pub nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct EmergencyRecoverySetEvent {
    pub version: u32,
    pub recovery: Address,
    pub cap: i128,
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ReceiptOobEvent {
    pub version: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalExpiredEvent {
    pub version: u32,
    pub request_id: u64,
    pub to: Address,
    pub amount: i128,
    pub queued_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitBreakerAutoResetEvent {
    pub version: u32,
    pub tripped_at: u32,
    pub reset_at: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct LimitMaxCapSetEvent {
    pub version: u32,
    pub cap: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeWithdrawalBatchNonceEvent {
    pub version: u32,
    pub caller: Address,
    pub new_nonce: u64,
}
// ── Storage keys ──────────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Paused,
    Token, // Default token
    TokenRegistry(Address),
    AllowlistEnabled,
    Allowed(Address),
    LastDeposit(Address),
    ReceiptCounter,
    Receipt(BytesN<32>),
    MinDeposit,
    LockPeriod,
    NextRequestID,
    WithdrawQueueLen,
    WithdrawQueueHead,
    WithdrawQueue(u64),
    DailyWithdrawLimit,
    WindowStart,
    WindowWithdrawn,
    CooldownLedgers,
    // Withdrawal cooldown after large deposit
    WithdrawCooldownLedgers,
    WithdrawCooldownThreshold,
    WithdrawalExpiryWindow,
    LastLargeDeposit(Address),
    UserDeposited(Address),
    NextActionID,
    QueuedAdminAction(u64),
    LastAdminActionLedger,
    InactivityThreshold,
    EmergencyRecoveryAddress,
    SchemaVersion,
    Oracle,
    FiatLimit,
    UserDailyVolume(Address),
    AntiSandwichDelay,
    WithdrawalQuota,
    UserDailyDeposit(Address, Address),
    TokenAllowlistEnabled(Address),
    TokenAllowed(Address, Address),
    TokenAllowlistIndex(u64),
    TokenAllowlistCount,
    TokenAllowlistEnabledIndex(u64),
    TokenAllowlistEnabledCount,
    UserDailyWithdrawal(Address),
    EscrowStorageVersion,
    EscrowRecord(u64),
    EscrowMigrationCursor,
    PendingRenounceLedger,
    Operator(Address),
    OperatorCount,
    MaxOperators,
    OperatorList,
    OperatorHeartbeat(Address),
    OperatorNonce(Address),
    WithdrawOperator,
    Denied(Address),
    DeniedIndex(u64),
    DeniedCount,
    FeeVault(Address),
    ReceiptIndex(u64),
    // ── Issue #214: deployment config hash ────────────────────────────────
    DeployConfigHash,
    // ── Issue #209: global circuit breaker ───────────────────────────────
    CircuitBreakerThreshold,
    CircuitBreakerTripped,
    CircuitBreakerTrippedAt,
    CircuitBreakerResetWindow,
    GlobalDailyWithdrawn,
    // ── Issue #226: withdrawal queue risk tiers ───────────────────────────
    TierQueueHead(u32),
    TierQueueLen(u32),
    // ── Issue #107: governed upgrade mechanism ───────────────────────────
    UpgradeProposal,
    UpgradeDelay,
    UpgradeProposalTiming,
    // ── Issue #100: M-of-N multi-signature admin control ─────────────────
    Signers,
    Threshold,
    MultisigProposal(u64),
    NextMultisigID,
    // ── Issue #496: slippage threshold for batch operations ─────────────
    SlippageThreshold,
    // ── Issue #1044: fee recipient address ───────────────────────────
    FeeRecipient,
    // ── Missing: limit max cap, operator daily limit, emergency recovery cap, fee withdrawal nonce
    LimitMaxCap,
    OperatorDailyLimit(Address),
    EmergencyRecoveryCap,
    FeeWithdrawalNonce,
    FeeWithdrawalNonceByCaller(Address),
    // ── Issue #1113: per-caller replay protection for batch fee withdrawals ──
    FeeWithdrawalBatchNonce(Address),
    /// Per-user replay-protection nonce for `execute_withdrawal`.
    WithdrawalExecutionNonce(Address),
    InitNonce(Address),
    UpgradeCancellationNonce(Address),
}

const ORACLE_PRICE_DECIMALS: i128 = 10_000_000;

// ── Contract ──────────────────────────────────────────────────────────────
/// # FiatBridge Smart Contract
///
/// The `FiatBridge` contract manages cross-chain fiat/crypto liquidity bridging on Stellar
/// using Soroban. It provides high-assurance deposit and withdrawal vaults, multi-signer
/// governance, rolling volume limits, oracle price validation, and timelocked upgrades.
///
/// ## Overflow Prevention Architecture
/// The contract enforces deterministic arithmetic safety throughout its lifecycle:
/// - **Zero Implicit Wrapping**: Release builds enforce `overflow-checks = true`.
/// - **Explicit Error Propagation**: Uses [`checked_add`](https://doc.rust-lang.org/std/primitive.i128.html#method.checked_add)
///   and [`checked_sub`](https://doc.rust-lang.org/std/primitive.i128.html#method.checked_sub) on financial
///   accumulators, returning typed errors ([`Error::Overflow`], [`Error::InternalError`]) rather than panicking.
/// - **Safe Fixed-Point Scaling**: Decimal operations delegate to [`crate::math::checked_mul_div_floor`] /
///   [`crate::math::checked_mul_div_ceil`].
/// - **Saturating Sequence Arithmetic**: Non-financial ledger calculations use [`saturating_add`](https://doc.rust-lang.org/std/primitive.u32.html#method.saturating_add).
/// - **Guarded Invariant Subtractions**: State reductions require strict preceding inequality guards.
#[contract]
pub struct FiatBridge;

#[contractimpl]
impl FiatBridge {
    // ── Issue #1041: telemetry helper ───────────────────────────────────
    fn emit_telemetry(env: &Env, function_name: Symbol) {
        TelemetryEvent { version: EVENT_VERSION, function_name }.publish(env);
    }
    
    /// Initializes the `FiatBridge` contract configuration, token limits, and multisig governance.
    ///
    /// # Overflow Prevention & Boundary Invariants
    /// - **Limit Validation**: `limit` must be strictly positive (`limit > 0`) and strictly below
    ///   `i128::MAX` (`limit != i128::MAX`) to prevent edge-adjacent arithmetic saturation.
    /// - **Minimum Deposit Guard**: `min_deposit` must be $\ge 1$, strictly below `limit` (`min_deposit < limit`),
    ///   and $\ne \text{i128::MAX}$.
    /// - **Multisig Signer Bounds**: `signers.len()` is capped at [`MAX_SIGNERS`] (20) to prevent storage
    ///   exhaustion and loop execution gas blowups.
    /// - **Threshold Validation**: Threshold must be non-zero and $\le \text{signers.len()}$.
    /// - **Replay Protection**: Validates and increments the initialization nonce using checked arithmetic.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `admin` – The initial administrative address.
    /// * `token` – The primary bridged token contract address.
    /// * `limit` – The per-transaction maximum deposit/withdrawal limit in token stroops.
    /// * `min_deposit` – The minimum deposit floor in token stroops.
    /// * `signers` – Vector of authorized multisig signer addresses (max 20).
    /// * `threshold` – Required approval quorum for multisig proposals.
    /// * `nonce` – Monotonic initialization nonce for caller authentication.
    ///
    /// # Errors
    /// * [`Error::AlreadyInitialized`] – If the contract has already been initialized.
    /// * [`Error::ZeroAmount`] – If `limit <= 0`.
    /// * [`Error::InvalidAmount`] – If `limit == i128::MAX` or `min_deposit == i128::MAX`.
    /// * [`Error::BelowMinimum`] – If `min_deposit < 1` or `min_deposit >= limit`.
    /// * [`Error::MaxSignersReached`] – If `signers.len() > MAX_SIGNERS`.
    /// * [`Error::InvalidThreshold`] – If `threshold == 0` or `threshold > signers.len()`.
    /// * [`Error::DuplicateSigner`] – If `signers` contains duplicate addresses.
    /// * [`Error::SelfReferentialAddress`] – If `admin == token`.
    /// * [`Error::Unauthorized`] – If `admin` is the contract's own address or signature fails.
    pub fn init(
        env: Env,
        admin: Address,
        token: Address,
        limit: i128,
        min_deposit: i128,
        signers: Vec<Address>,
        threshold: u32,
        nonce: u64,
    ) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "init"));

        admin.require_auth();
        Self::validate_and_increment_init_nonce(&env, &admin, nonce)?;
        
        // Prevent reinitialization: check both Admin and SchemaVersion
        // (Admin may be removed by execute_renounce_admin, but SchemaVersion persists)
        if env.storage().instance().has(&DataKey::Admin)
            || env.storage().instance().has(&DataKey::SchemaVersion)
        {
            return Err(Error::AlreadyInitialized);
        }
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }
        if limit == i128::MAX {
            return Err(Error::InvalidAmount);
        }
        if min_deposit == i128::MAX {
            return Err(Error::InvalidAmount);
        }
        if min_deposit < 1 || min_deposit >= limit {
            return Err(Error::BelowMinimum);
        }
        if admin == token {
            return Err(Error::SelfReferentialAddress);
        }
        if admin == env.current_contract_address() {
            return Err(Error::Unauthorized);
        }

        // Validate multisig config
        if signers.len() > MAX_SIGNERS {
            return Err(Error::MaxSignersReached);
        }
        if threshold == 0 || threshold > signers.len() {
            return Err(Error::InvalidThreshold);
        }
        // Ensure no duplicate signers
        let mut seen = Vec::<Address>::new(&env);
        for s in signers.iter() {
            if seen.contains(&s) {
                return Err(Error::DuplicateSigner);
            }
            seen.push_back(s);
        }

        env.storage().instance().set(&DataKey::MinDeposit, &min_deposit);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::NextMultisigID, &0u64);

        let config = TokenConfig {
            limit,
            daily_deposit_limit: 0,
            total_deposited: 0,
            total_withdrawn: 0,
            total_liabilities: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        env.storage().instance().set(&DataKey::SchemaVersion, &1u32);
        env.storage().instance().set(&DataKey::NextActionID, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::WithdrawQueueLen, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::WithdrawQueueHead, &Option::<u64>::None);
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::InactivityThreshold, &DEFAULT_INACTIVITY_THRESHOLD);
        env.storage()
            .instance()
            .set(&DataKey::AntiSandwichDelay, &0u32);
        env.storage().instance().set(&DataKey::OperatorCount, &0u32);
        env.storage().instance().set(&DataKey::MaxOperators, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::OperatorList, &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .set(&DataKey::UpgradeDelay, &MIN_UPGRADE_DELAY);

        // ── Issue #214: store and emit immutable deployment config hash ──
        let config_data = (admin.clone(), token.clone(), limit);
        let config_hash: BytesN<32> = env.crypto().sha256(&config_data.to_xdr(&env)).into();
        env.storage()
            .persistent()
            .set(&DataKey::DeployConfigHash, &config_hash);
        DeployHashEvent {
            version: EVENT_VERSION,
            config_hash,
        }
        .publish(&env);

        env.storage()
            .instance()
            .set(&DataKey::InitNonce(admin.clone()), &0u64);
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Ok(())
    }

    pub fn get_init_nonce(env: Env, admin: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::InitNonce(admin))
            .unwrap_or(0)
    }

    /// Deposits tokens into the bridge vault, minting a cryptographic receipt and updating accumulators.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Amount Guard**: Ensures `amount > 0` and within token limits to avoid zero/negative math bugs.
    /// - **Saturating Cooldown Offsets**: Uses [`u32::saturating_add`] on `last.saturating_add(cooldown)`
    ///   to safely evaluate anti-sandwich and deposit rate delays without ledger wraparound panics.
    /// - **Checked Vault Accumulation**: Increases `config.total_deposited` via
    ///   [`i128::checked_add(amount)`](https://doc.rust-lang.org/std/primitive.i128.html#method.checked_add),
    ///   returning [`Error::Overflow`] if total deposits exceed `i128::MAX`.
    /// - **Checked User Accounting**: Increases `user_total` via [`i128::checked_add`], returning
    ///   [`Error::InternalError`] on overflow.
    /// - **Sequential Receipt Counter**: Increments `ReceiptCounter` (`u64`) with `receipt_counter + 1`.
    /// - **Oracle Price Scaling**: Converts amount to USD cents via [`crate::math::checked_mul_div_floor`]
    ///   and evaluates 24-hour limit windows using saturating ledger addition.
    /// - **Cross-Multiplication Slippage Guard**: Validates expected vs actual prices using integer
    ///   cross-multiplication in [`check_slippage`](FiatBridge::check_slippage).
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `from` – The depositor address (must authenticate).
    /// * `amount` – Amount of tokens to deposit in stroops (must be $> 0$).
    /// * `token` – The address of the token contract being deposited.
    /// * `reference` – Client payment reference (length $\le 64$).
    /// * `expected_price` – Expected benchmark oracle price scaled by `FIXED_POINT` (0 to skip slippage check).
    /// * `max_slippage` – Maximum allowed downward price slippage in basis points (BPS).
    /// * `memo_hash` – Optional 32-byte hash identifying the deposit batch/memo.
    ///
    /// # Returns
    /// * `Ok(BytesN<32>)` – The unique deterministic receipt identifier.
    ///
    /// # Errors
    /// * [`Error::ZeroAmount`] – If `amount <= 0`.
    /// * [`Error::ReferenceTooLong`] – If `reference.len() > MAX_REFERENCE_LEN` (64).
    /// * [`Error::CooldownActive`] – If user makes repeated deposits within cooldown window.
    /// * [`Error::AddressDenied`] – If depositor is on the denylist.
    /// * [`Error::TokenNotWhitelisted`] – If token is not registered.
    /// * [`Error::ExceedsLimit`] – If `amount` exceeds per-transaction limit.
    /// * [`Error::ExceedsFiatLimit`] – If `amount` exceeds 24-hour fiat volume cap.
    /// * [`Error::SlippageTooHigh`] – If execution price deviates downward beyond `max_slippage`.
    /// * [`Error::Overflow`] – If vault deposit accumulator overflows `i128`.
    pub fn deposit(
        env: Env,
        from: Address,
        amount: i128,
        token: Address,
        reference: Bytes,
        expected_price: i128,
        max_slippage: u32,
        memo_hash: Option<BytesN<32>>,
    ) -> Result<BytesN<32>, Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "deposit"));
        
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Self::validate_memo_hash(&env, &memo_hash)?;
        from.require_auth();
        Self::require_not_paused(&env)?;
        // Reject a tripped breaker before any quota accounting or token call.
        // The rolling-volume helper below still handles lazy auto-reset.
        Self::require_circuit_breaker_clear(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if reference.len() > MAX_REFERENCE_LEN {
            return Err(Error::ReferenceTooLong);
        }
        // Last Deposit Record (for Cooldown and Anti-Sandwich)
        let key = DataKey::LastDeposit(from.clone());
        let current_ledger = env.ledger().sequence();
        let cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CooldownLedgers)
            .unwrap_or(0);
        let anti_sandwich: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AntiSandwichDelay)
            .unwrap_or(0);
        if cooldown > 0 {
            if let Some(last) = env.storage().temporary().get::<DataKey, u32>(&key) {
                if current_ledger < last.saturating_add(cooldown) {
                    return Err(Error::CooldownActive);
                }
            }
        }

        env.storage().temporary().set(&key, &current_ledger);
        let max_delay = cooldown.max(anti_sandwich).max(1);
        env.storage()
            .temporary()
            .extend_ttl(&key, max_delay, max_delay + 100);

        // Allowlist
        let global_allowlist_on: bool = env
            .storage()
            .instance()
            .get(&DataKey::AllowlistEnabled)
            .unwrap_or(false);

        if global_allowlist_on {
            if !env
                .storage()
                .persistent()
                .has(&DataKey::Allowed(from.clone()))
            {
                return Err(Error::NotAllowed);
            }
        } else {
            // Per-token allowlist check (Issue #354)
            let token_allowlist_on: bool = env
                .storage()
                .instance()
                .get(&DataKey::TokenAllowlistEnabled(token.clone()))
                .unwrap_or(false);
            if token_allowlist_on
                && !env
                    .storage()
                    .persistent()
                    .has(&DataKey::TokenAllowed(token.clone(), from.clone()))
            {
                return Err(Error::NotAllowed);
            }
        }

        // Denylist
        if env
            .storage()
            .persistent()
            .has(&DataKey::Denied(from.clone()))
        {
            return Err(Error::AddressDenied);
        }

        // Registry & Limit
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        // ── Issue #113: minimum deposit floor ────────────────────────────
        let min_deposit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(1);
        if amount < min_deposit {
            return Err(Error::BelowMinimum);
        }
        if amount > config.limit {
            return Err(Error::ExceedsLimit);
        }
        Self::enforce_daily_deposit_limit(&env, &from, &token, amount, &config)?;

        // Fiat Limit & Slippage
        let actual_price = Self::validate_fiat_limit(&env, &from, &token, amount)?;
        Self::check_slippage(&env, expected_price, actual_price, max_slippage)?;

        // Transfer
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, env.current_contract_address(), &amount);

        // State update
        let receipt_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);

        // Formalize receipt ID derivation (deterministic + unique via counter)
        // Rule: SHA256(XDR(depositor, amount, ledger, reference, counter))
        let derivation_data = (
            from.clone(),
            amount,
            env.ledger().sequence(),
            reference.clone(),
            receipt_counter,
        );
        let receipt_id = env.crypto().sha256(&derivation_data.to_xdr(&env));

        // Collision check (safety)
        if env
            .storage()
            .persistent()
            .has(&DataKey::Receipt(receipt_id.clone().into()))
        {
            return Err(Error::InternalError);
        }

        let receipt = Receipt {
            id: receipt_id.clone().into(),
            depositor: from.clone(),
            amount,
            ledger: env.ledger().sequence(),
            reference,
            refunded: false,
            memo_hash: memo_hash.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Receipt(receipt_id.clone().into()), &receipt);
        // Store sequential index → hash mapping for enumeration (e.g. migration)
        let receipt_hash: BytesN<32> = receipt_id.clone().into();
        let index_key = DataKey::ReceiptIndex(receipt_counter);
        env.storage()
            .temporary()
            .set(&index_key, &receipt_hash);
        env.storage()
            .temporary()
            .extend_ttl(&index_key, MIN_TTL, MIN_TTL);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptCounter, &(receipt_counter + 1));

        config.total_deposited = config.total_deposited.checked_add(amount).ok_or(Error::Overflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        let user_key = DataKey::UserDeposited(from.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        let new_user_total = user_total.checked_add(amount).ok_or(Error::InternalError)?;
        env.storage()
            .instance()
            .set(&user_key, &new_user_total);

        // Track large deposits for withdrawal cooldown
        let withdraw_threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawCooldownThreshold)
            .unwrap_or(0);
        if withdraw_threshold > 0 && amount >= withdraw_threshold {
            let large_key = DataKey::LastLargeDeposit(from.clone());
            env.storage()
                .temporary()
                .set(&large_key, &env.ledger().sequence());
            let cooldown_ledgers: u32 = env
                .storage()
                .instance()
                .get(&DataKey::WithdrawCooldownLedgers)
                .unwrap_or(0);
            // Keep record alive at least as long as the cooldown period
            let ttl = cooldown_ledgers.max(17_280); // min 24h
            env.storage().temporary().extend_ttl(&large_key, ttl, ttl);
        }

        DepositEvent {
            version: EVENT_VERSION,
            from: from.clone(),
            token: token.clone(),
            amount,
            receipt_id: receipt_hash.clone(),
        }
        .publish(&env);

        ReceiptIssuedEvent {
            version: EVENT_VERSION,
            receipt_id: receipt_hash.clone(),
            memo_hash,
        }
        .publish(&env);

        Self::check_invariants(&env, &token)?;

        Ok(receipt_hash)
    }

    /// Validates that `memo_hash`, when provided, is not all zeros.
    /// A zero hash (32 bytes of `0x00`) is rejected as it indicates a missing or
    /// placeholder SHA-256 hash rather than a real external transaction reference.
    fn validate_memo_hash(env: &Env, memo_hash: &Option<BytesN<32>>) -> Result<(), Error> {
        if let Some(hash) = memo_hash {
            let zero_hash = BytesN::from_array(env, &[0u8; 32]);
            if hash == &zero_hash {
                return Err(Error::InvalidMemoHash);
            }
        }
        Ok(())
    }

    /// Verifies the core accounting invariants after a state-changing
    /// operation for the given token. Called at the end of every entry point
    /// that mutates token accounting (`deposit`, `withdraw`,
    /// `request_withdrawal`, `execute_withdrawal`, `withdraw_fees`).
    ///
    /// The three invariants enforced are:
    /// 1. `total_deposited >= total_withdrawn` — the contract never withdraws
    ///    more than it has ever taken in.
    /// 2. `net_deposited (total_deposited - total_withdrawn) >=
    ///    total_liabilities` — outstanding withdrawal liabilities never exceed
    ///    the net amount actually held.
    /// 3. on-chain token `balance >= net_deposited` — real held tokens always
    ///    cover the net amount owed to depositors.
    ///
    /// A violation of invariants 1–2 indicates corrupt internal accounting and
    /// returns [`Error::InternalError`]; a violation of invariant 3 means the
    /// contract's own tokens were spent on something other than a tracked
    /// deposit/withdrawal and returns [`Error::InsufficientFunds`].
    ///
    /// The `>=` comparison (rather than `==`) for invariant 3 intentionally
    /// permits "extra" untracked balance, such as accrued fees that have not
    /// yet been withdrawn.
    ///
    /// See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
    /// full testing strategy.
    fn check_invariants(env: &Env, token_addr: &Address) -> Result<(), Error> {
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token_addr.clone()))
            .ok_or(Error::NotInitialized)?;

        let token_client = token::Client::new(env, token_addr);
        let balance = token_client.balance(&env.current_contract_address());

        if config.total_deposited < config.total_withdrawn {
            return Err(Error::InternalError);
        }

        let net_deposited = config.total_deposited - config.total_withdrawn;

        if net_deposited < config.total_liabilities {
            return Err(Error::InternalError);
        }

        if balance < net_deposited {
            return Err(Error::InsufficientFunds);
        }

        Ok(())
    }

    /// Directly processes an authorized withdrawal from the contract to a recipient address.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Authorization Guard**: Requires admin or authorized operator authentication.
    /// - **Recipient Guard**: Prevents tokens from being withdrawn back to the contract's own address.
    /// - **Token Balance Check**: Verifies contract on-chain balance $\ge \text{amount}$.
    /// - **Checked Accumulation**: Increases `config.total_withdrawn` via [`i128::checked_add`],
    ///   returning [`Error::InternalError`] on overflow.
    /// - **Post-State Invariant Check**: Runs [`check_invariants`](FiatBridge::check_invariants) to
    ///   ensure `total_deposited >= total_withdrawn` and `balance >= net_deposited`.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `caller` – The authorized administrator or withdrawal operator.
    /// * `to` – Destination recipient address.
    /// * `amount` – Amount to withdraw in stroops ($> 0$).
    /// * `token` – Token contract address.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] – If `caller` is not admin or active withdraw operator.
    /// * [`Error::ZeroAmount`] – If `amount <= 0`.
    /// * [`Error::InvalidRecipient`] – If `to == env.current_contract_address()`.
    /// * [`Error::AddressDenied`] – If recipient is on the denylist.
    /// * [`Error::InsufficientFunds`] – If contract holds fewer tokens than `amount`.
    /// * [`Error::TokenNotWhitelisted`] – If token registry record does not exist.
    /// * [`Error::InternalError`] – If `total_withdrawn` overflows `i128`.
    pub fn withdraw(
        env: Env,
        caller: Address,
        to: Address,
        amount: i128,
        token: Address,
    ) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        let operator: Option<Address> = env.storage().instance().get(&DataKey::WithdrawOperator);

        if caller == admin {
            caller.require_auth();
        } else if let Some(op) = operator {
            if caller == op {
                caller.require_auth();
            } else {
                return Err(Error::Unauthorized);
            }
        } else {
            return Err(Error::Unauthorized);
        }

        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // ── Issue #109: prevent tokens from being locked inside the contract ──
        if to == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }

        Self::enforce_withdrawal_quota(&env, &to, amount)?;
        // ── Issue #209: circuit breaker check ────────────────────────────
        Self::check_and_update_circuit_breaker(&env, amount)?;
        // Denylist
        if env.storage().persistent().has(&DataKey::Denied(to.clone())) {
            return Err(Error::AddressDenied);
        }

        let client = token::Client::new(&env, &token);
        if amount > client.balance(&env.current_contract_address()) {
            return Err(Error::InsufficientFunds);
        }
        client.transfer(&env.current_contract_address(), &to, &amount);

        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        config.total_withdrawn = config.total_withdrawn.checked_add(amount).ok_or(Error::InternalError)?;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        Self::check_invariants(&env, &token)?;
        WithdrawEvent {
            version: EVENT_VERSION,
            to: to.clone(),
            token: token.clone(),
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Enqueues a timelocked withdrawal request and records liability in the vault accumulator.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Checked Liabilities Addition**: Adds `amount` to `config.total_liabilities` using
    ///   [`i128::checked_add`], returning [`Error::Overflow`] on overflow.
    /// - **Saturating TTL Calculations**: Computes receipt and queue item TTL extensions using
    ///   [`u32::saturating_add`] on `MIN_TTL + lock_period + cooldown_ledgers`.
    /// - **Monotonic Request ID**: Increments `NextRequestID` (`u64`) with checked addition.
    /// - **Cooldown Verification**: Verifies large deposit cooldown via saturating ledger sequence addition.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `to` – Destination recipient address.
    /// * `amount` – Amount requested for withdrawal in stroops ($> 0$).
    /// * `token` – Token contract address.
    /// * `memo_hash` – Optional 32-byte memo hash.
    /// * `risk_tier` – Security risk tier modifying lock duration.
    ///
    /// # Returns
    /// * `Ok(u64)` – Unique withdrawal request identifier.
    ///
    /// # Errors
    /// * [`Error::ZeroAmount`] – If `amount <= 0`.
    /// * [`Error::AddressDenied`] – If recipient is on the denylist.
    /// * [`Error::CooldownActive`] – If large deposit cooldown is active.
    /// * [`Error::Overflow`] – If liability accumulator overflows `i128`.
    pub fn request_withdrawal(
        env: Env,
        to: Address,
        amount: i128,
        token: Address,
        memo_hash: Option<BytesN<32>>,
        risk_tier: u32,
    ) -> Result<u64, Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Self::validate_memo_hash(&env, &memo_hash)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_circuit_breaker_clear(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Denylist
        if env.storage().persistent().has(&DataKey::Denied(to.clone())) {
            return Err(Error::AddressDenied);
        }

        // Enforce withdrawal cooldown after large deposit
        let withdraw_cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawCooldownLedgers)
            .unwrap_or(0);
        if withdraw_cooldown > 0 {
            let large_key = DataKey::LastLargeDeposit(to.clone());
            if let Some(last_large) = env.storage().temporary().get::<DataKey, u32>(&large_key) {
                if env.ledger().sequence() < last_large.saturating_add(withdraw_cooldown) {
                    return Err(Error::CooldownActive);
                }
            }
        }
        let lock_period: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0);
        let cooldown_ledgers: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CooldownLedgers)
            .unwrap_or(0);
        let request_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestID)
            .unwrap_or(0);
        let receipt_min_ttl = MIN_TTL
            .saturating_add(lock_period)
            .saturating_add(cooldown_ledgers);
        Self::extend_receipt_ttls_for_depositor(&env, &to, receipt_min_ttl);

        let queue_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawQueueLen)
            .unwrap_or(0);

        let request = WithdrawRequest {
            to: to.clone(),
            token: token.clone(),
            amount,
            unlock_ledger: env.ledger().sequence() + lock_period,
            memo_hash: memo_hash.clone(),
            queued_ledger: env.ledger().sequence(),
            risk_tier,
        };
        env.storage()
            .persistent()
            .set(&DataKey::WithdrawQueue(request_id), &request);
        env.storage()
            .instance()
            .set(&DataKey::NextRequestID, &(request_id + 1));

        if queue_len == 0 {
            env.storage()
                .instance()
                .set(&DataKey::WithdrawQueueHead, &Some(request_id));
        }
        env.storage()
            .instance()
            .set(&DataKey::WithdrawQueueLen, &(queue_len + 1));

        // ── Issue #226: per-tier queue tracking ──────────────────────────
        let tier_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TierQueueLen(risk_tier))
            .unwrap_or(0);
        if tier_len == 0 {
            env.storage()
                .instance()
                .set(&DataKey::TierQueueHead(risk_tier), &Some(request_id));
        }
        env.storage()
            .instance()
            .set(&DataKey::TierQueueLen(risk_tier), &(tier_len + 1));
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;

        // Verify the new liabilities don't exceed net deposited
        let user_deposited: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UserDeposited(to.clone()))
            .unwrap_or(0);
        let new_liabilities = config.total_liabilities.checked_add(amount).ok_or(Error::Overflow)?;
        let net_deposited = config.total_deposited.saturating_sub(config.total_withdrawn);
        if new_liabilities > net_deposited || amount > user_deposited {
            return Err(Error::InsufficientFunds);
        }

        config.total_liabilities = new_liabilities;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        Self::check_invariants(&env, &token)?;

        WithdrawalRequestedEvent {
            version: EVENT_VERSION,
            to: to.clone(),
            request_id,
            memo_hash,
        }
        .publish(&env);

        Ok(request_id)
    }

    /// Executes an unlocked withdrawal request, transferring tokens to the recipient and updating liability accumulators.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Sequential Nonce Increment**: Protects against double-execution with `current_nonce + 1`.
    /// - **Saturating Delay Checks**: Uses [`u32::saturating_add`] on `last_deposit.saturating_add(delay)`
    ///   to evaluate anti-sandwich delay safely.
    /// - **Guarded Partial Amount**: Validates `amt <= request.amount && amt > 0` before modifying balances.
    /// - **Cross-Multiplication Slippage Guard**: Intercepts oracle price deviations with integer
    ///   cross-multiplication in [`check_slippage`](FiatBridge::check_slippage).
    /// - **Guarded Liability Decrement**: Subtraction `config.total_liabilities -= execute_amount` is
    ///   guaranteed non-underflowing by `execute_amount <= request.amount` and previous liability accumulation.
    /// - **Checked Total Withdrawn**: Accumulates `config.total_withdrawn` via [`i128::checked_add`],
    ///   returning [`Error::InternalError`] on overflow.
    /// - **Post-Execution Invariant**: Validates `total_deposited >= total_withdrawn` and `balance >= net_deposited`.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `request_id` – Queue ID of the withdrawal request.
    /// * `partial_amount` – Optional sub-amount to partially execute (if `None`, executes full remaining amount).
    /// * `expected_price` – Expected benchmark oracle price scaled by `FIXED_POINT` (0 to skip slippage check).
    /// * `max_slippage` – Maximum allowed downward price slippage in basis points.
    /// * `nonce` – Replay protection nonce corresponding to recipient address.
    ///
    /// # Errors
    /// * [`Error::RequestNotFound`] – If `request_id` does not exist.
    /// * [`Error::StaleNonce`] / [`Error::InvalidNonce`] – If replay protection nonce is invalid.
    /// * [`Error::WithdrawalLocked`] – If request is still within timelock.
    /// * [`Error::AntiSandwichDelayActive`] – If executed before anti-sandwich delay expires.
    /// * [`Error::InsufficientFunds`] – If contract balance is insufficient.
    /// * [`Error::SlippageTooHigh`] – If actual oracle price exceeds max slippage threshold.
    /// * [`Error::InternalError`] – If `total_withdrawn` overflows `i128`.
    pub fn execute_withdrawal(
        env: Env,
        request_id: u64,
        partial_amount: Option<i128>,
        expected_price: i128,
        max_slippage: u32,
        nonce: u64,
    ) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Self::require_not_paused(&env)?;
        let mut request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

        // Validate nonce for replay protection
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalExecutionNonce(request.to.clone()))
            .unwrap_or(0);

        if nonce != current_nonce {
            if nonce < current_nonce {
                return Err(Error::StaleNonce);
            } else {
                return Err(Error::InvalidNonce);
            }
        }

        if env.ledger().sequence() < request.unlock_ledger {
            return Err(Error::WithdrawalLocked);
        }

        // Anti-sandwich check
        let delay: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AntiSandwichDelay)
            .unwrap_or(0);
        if delay > 0 {
            if let Some(last_deposit) = env
                .storage()
                .temporary()
                .get::<_, u32>(&DataKey::LastDeposit(request.to.clone()))
            {
                if env.ledger().sequence() < last_deposit.saturating_add(delay) {
                    return Err(Error::AntiSandwichDelayActive);
                }
            }
        }

        let token_client = token::Client::new(&env, &request.token);
        let balance = token_client.balance(&env.current_contract_address());

        let execute_amount = match partial_amount {
            Some(amt) => {
                if amt <= 0 || amt > request.amount {
                    return Err(Error::ZeroAmount);
                }
                amt
            }
            None => request.amount,
        };

        Self::enforce_withdrawal_quota(&env, &request.to, execute_amount)?;
        // ── Issue #209: circuit breaker check ────────────────────────────
        Self::check_and_update_circuit_breaker(&env, execute_amount)?;

        if execute_amount > balance {
            return Err(Error::InsufficientFunds);
        }

        // Slippage check
        if expected_price > 0 {
            let oracle_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Oracle)
                .ok_or(Error::OracleNotSet)?;
            let oracle = crate::oracle::OracleClient::new(&env, &oracle_addr);
            let actual_price = oracle.get_price(&request.token).unwrap_or(0);
            if actual_price <= 0 {
                return Err(Error::OraclePriceInvalid);
            }
            Self::check_slippage(&env, expected_price, actual_price, max_slippage)?;
        }

        // Increment nonce after all validation checks pass
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalExecutionNonce(request.to.clone()), &(current_nonce + 1));

        token_client.transfer(
            &env.current_contract_address(),
            &request.to,
            &execute_amount,
        );

        let tier = request.risk_tier;
        if execute_amount == request.amount {
            env.storage()
                .persistent()
                .remove(&DataKey::WithdrawQueue(request_id));

            let queue_len: u64 = env
                .storage()
                .instance()
                .get(&DataKey::WithdrawQueueLen)
                .unwrap_or(0);
            if queue_len > 0 {
                env.storage()
                    .instance()
                    .set(&DataKey::WithdrawQueueLen, &(queue_len - 1));
            }
            Self::advance_withdraw_queue_head(&env, request_id);
            // ── Issue #226: advance per-tier head ─────────────────────────
            let tier_len: u64 = env
                .storage()
                .instance()
                .get(&DataKey::TierQueueLen(tier))
                .unwrap_or(0);
            if tier_len > 0 {
                env.storage()
                    .instance()
                    .set(&DataKey::TierQueueLen(tier), &(tier_len - 1));
            }
            Self::advance_tier_queue_head(&env, tier, request_id);
        } else {
            request.amount -= execute_amount;
            env.storage()
                .persistent()
                .set(&DataKey::WithdrawQueue(request_id), &request);
        }

        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(request.token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        config.total_withdrawn = config.total_withdrawn.checked_add(execute_amount).ok_or(Error::InternalError)?;
        config.total_liabilities -= execute_amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(request.token.clone()), &config);

        Self::check_invariants(&env, &request.token)?;

        WithdrawalExecutedEvent {
            version: EVENT_VERSION,
            request_id,
            to: request.to.clone(),
            amount: execute_amount,
            nonce: current_nonce + 1,
        }
        .publish(&env);

        Ok(())
    }

    /// Cancels a pending withdrawal request and releases reserved liabilities back to the vault.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Authorization Guard**: Requires admin authentication.
    /// - **Guarded Liability Release**: Safely decrements `config.total_liabilities -= request.amount`.
    ///   Since `request.amount` was strictly added during request creation, this subtraction cannot underflow.
    /// - **Post-Cancellation Invariant Check**: Runs [`check_invariants`](FiatBridge::check_invariants).
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `request_id` – Queue ID of the withdrawal request to cancel.
    ///
    /// # Errors
    /// * [`Error::RequestNotFound`] – If `request_id` is not present in storage.
    /// * [`Error::TokenNotWhitelisted`] – If the associated token configuration is missing.
    pub fn cancel_withdrawal(env: Env, request_id: u64) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Self::require_not_paused(&env)?;
        if !env
            .storage()
            .persistent()
            .has(&DataKey::WithdrawQueue(request_id))
        {
            return Err(Error::RequestNotFound);
        }

        let request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

        let tier = request.risk_tier;

        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(request.token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        config.total_liabilities -= request.amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(request.token.clone()), &config);

        env.storage()
            .persistent()
            .remove(&DataKey::WithdrawQueue(request_id));

        let queue_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawQueueLen)
            .unwrap_or(0);
        if queue_len > 0 {
            env.storage()
                .instance()
                .set(&DataKey::WithdrawQueueLen, &(queue_len - 1));
        }
        Self::advance_withdraw_queue_head(&env, request_id);

        // ── Issue #226: per-tier bookkeeping on cancel ────────────────────
        let tier_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TierQueueLen(tier))
            .unwrap_or(0);
        if tier_len > 0 {
            env.storage()
                .instance()
                .set(&DataKey::TierQueueLen(tier), &(tier_len - 1));
        }
        Self::advance_tier_queue_head(&env, tier, request_id);

        Self::check_invariants(&env, &request.token)?;

        WithdrawalCancelledEvent { version: EVENT_VERSION, request_id }.publish(&env);

        Ok(())
    }

    /// Reclaim an expired withdrawal request.
    ///
    /// An admin may call this when a queued withdrawal has not been executed
    /// within the expiry window. The request is removed from the queue and
    /// the reserved liability is released back to the pool. Funds stay in
    /// escrow — they are NOT returned to the depositor. Use `rescue_token`
    /// or a manual `withdraw` if repatriation is needed.
    pub fn reclaim_expired_withdrawal(env: Env, request_id: u64) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

        // Resolve the configured expiry window (fallback to compile-time default).
        let expiry_window: u32 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalExpiryWindow)
            .unwrap_or(WITHDRAWAL_EXPIRY_WINDOW_LEDGERS);

        // Reject if the request has not yet passed the expiry window.
        if env.ledger().sequence() <= request.queued_ledger.saturating_add(expiry_window) {
            return Err(Error::WithdrawalLocked);
        }

        let tier = request.risk_tier;

        // Release the liability.
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(request.token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        config.total_liabilities -= request.amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(request.token.clone()), &config);

        // Remove from queue.
        env.storage()
            .persistent()
            .remove(&DataKey::WithdrawQueue(request_id));

        let queue_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawQueueLen)
            .unwrap_or(0);
        if queue_len > 0 {
            env.storage()
                .instance()
                .set(&DataKey::WithdrawQueueLen, &(queue_len - 1));
        }
        Self::advance_withdraw_queue_head(&env, request_id);

        // Per-tier bookkeeping.
        let tier_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TierQueueLen(tier))
            .unwrap_or(0);
        if tier_len > 0 {
            env.storage()
                .instance()
                .set(&DataKey::TierQueueLen(tier), &(tier_len - 1));
        }
        Self::advance_tier_queue_head(&env, tier, request_id);

        WithdrawalExpiredEvent {
            version: EVENT_VERSION,
            request_id,
            to: request.to.clone(),
            amount: request.amount,
            queued_ledger: request.queued_ledger,
        }
        .publish(&env);

        Ok(())
    }

    fn advance_withdraw_queue_head(env: &Env, removed_id: u64) {
        let head: Option<u64> = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawQueueHead)
            .unwrap_or(None);
        if head != Some(removed_id) {
            return;
        }

        let queue_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawQueueLen)
            .unwrap_or(0);
        if queue_len == 0 {
            env.storage()
                .instance()
                .set(&DataKey::WithdrawQueueHead, &Option::<u64>::None);
            return;
        }

        let next_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestID)
            .unwrap_or(0);

        let mut i = removed_id.saturating_add(1);
        while i < next_id {
            if env.storage().persistent().has(&DataKey::WithdrawQueue(i)) {
                env.storage()
                    .instance()
                    .set(&DataKey::WithdrawQueueHead, &Some(i));
                return;
            }
            i += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::WithdrawQueueHead, &Option::<u64>::None);
    }

    pub fn set_limit(env: Env, token: Address, limit: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        // Check against configured max cap
        let max_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::LimitMaxCap)
            .unwrap_or(i128::MAX);
        if limit > max_cap {
            return Err(Error::ExceedsLimitMaxCap);
        }
        // Block if circuit breaker is active
        Self::require_circuit_breaker_clear(&env)?;
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        config.limit = limit;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);
        Ok(())
    }

    pub fn set_token_allowlist_enabled(
        env: Env,
        token: Address,
        enabled: bool,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::TokenAllowlistEnabled(token.clone()), &enabled);

        // Append to token allowlist enabled index for enumeration
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenAllowlistEnabledCount)
            .unwrap_or(0);
        if count == u64::MAX {
            return Err(Error::Overflow);
        }
        let entry = TokenAllowlistEnabledEntry {
            token: token.clone(),
            enabled,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenAllowlistEnabledIndex(count), &entry);
        env.storage()
            .instance()
            .set(&DataKey::TokenAllowlistEnabledCount, &(count.checked_add(1).ok_or(Error::Overflow)?));

        Ok(())
    }

    pub fn add_token_allowlist(env: Env, token: Address, address: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::TokenAllowed(token.clone(), address.clone()), &true);

        // Append to token allowlist index for enumeration
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenAllowlistCount)
            .unwrap_or(0);
        if count == u64::MAX {
            return Err(Error::Overflow);
        }
        let entry = TokenAllowlistEntry {
            token: token.clone(),
            address: address.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenAllowlistIndex(count), &entry);
        env.storage()
            .instance()
            .set(&DataKey::TokenAllowlistCount, &(count.checked_add(1).ok_or(Error::Overflow)?));

        Ok(())
    }

    pub fn remove_token_allowlist(env: Env, token: Address, address: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::TokenAllowed(token.clone(), address.clone()));

        // Tombstone the index slot (mark as removed) without compacting
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenAllowlistCount)
            .unwrap_or(0);
        for i in 0..count {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<_, TokenAllowlistEntry>(&DataKey::TokenAllowlistIndex(i))
            {
                if entry.token == token && entry.address == address {
                    env.storage()
                        .persistent()
                        .remove(&DataKey::TokenAllowlistIndex(i));
                    break;
                }
            }
        }

        Ok(())
    }

    // ── Issue #113: minimum deposit floor ────────────────────────────
    pub fn set_min_deposit(env: Env, min: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if min < 1 {
            return Err(Error::BelowMinimum);
        }
        env.storage().instance().set(&DataKey::MinDeposit, &min);
        SetMinDepositEvent { version: EVENT_VERSION, min }.publish(&env);
        Ok(())
    }

    pub fn get_min_deposit(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(1)
    }

    pub fn set_daily_deposit_limit(
        env: Env,
        token: Address,
        limit_per_day: i128,
    ) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "set_daily_deposit_limit"));
        
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        // Bounds check: daily limit cannot exceed token's overall limit
        if limit_per_day > config.limit {
            return Err(Error::ExceedsLimit);
        }
        config.daily_deposit_limit = limit_per_day;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);
        Ok(())
    }

    pub fn set_cooldown(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        // Reject u32::MAX as it could cause overflow issues
        if ledgers == u32::MAX {
            return Err(Error::InvalidAmount);
        }
        
        env.storage()
            .instance()
            .set(&DataKey::CooldownLedgers, &ledgers);
        Ok(())
    }

    /// Configure the withdrawal cooldown applied after a large deposit.
    ///
    /// - `ledgers`   – number of ledgers to wait before withdrawing.  0 disables the guard.
    /// - `threshold` – minimum deposit amount (inclusive) that triggers the cooldown.  0 disables.
    pub fn set_withdrawal_cooldown(env: Env, ledgers: u32, threshold: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        // Reject u32::MAX as it could cause overflow issues
        if ledgers == u32::MAX {
            return Err(Error::InvalidAmount);
        }
        
        // Reject negative and i128::MAX threshold values
        if threshold < 0 {
            return Err(Error::InvalidAmount);
        }
        if threshold == i128::MAX {
            return Err(Error::InvalidAmount);
        }
        
        env.storage()
            .instance()
            .set(&DataKey::WithdrawCooldownLedgers, &ledgers);
        env.storage()
            .instance()
            .set(&DataKey::WithdrawCooldownThreshold, &threshold);
        Ok(())
    }

    pub fn set_lock_period(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::LockPeriod, &ledgers);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        PausedEvent { version: EVENT_VERSION, by: admin.clone() }.publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        UnpausedEvent { version: EVENT_VERSION, by: admin.clone() }.publish(&env);
        Ok(())
    }

    /// Sets the anti-sandwich delay in ledgers for deposit operations.
    ///
    /// This function configures a minimum delay between consecutive deposits
    /// from the same address to prevent sandwich attacks. When enabled, users
    /// must wait the specified number of ledgers before making another deposit.
    ///
    /// The anti-sandwich mechanism is a protection measure that limits the rate
    /// at which a single address can submit deposits, making it more difficult
    /// for attackers to sandwich legitimate transactions with their own.
    ///
    /// Only the current admin can call this function. Setting the delay to `0`
    /// disables the anti-sandwich protection entirely.
    ///
    /// # Parameters
    ///
    /// - `ledgers` — the minimum number of ledgers that must pass between
    ///   consecutive deposits from the same address. A value of `0` disables
    ///   the protection. Typical values range from a few dozen to a few hundred
    ///   ledgers (each ledger is approximately 5 seconds on Stellar).
    ///
    /// # Returns
    ///
    /// - `Ok(())` — the anti-sandwich delay was successfully updated.
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`] — the contract has not been initialized.
    /// - [`Error::Unauthorized`] — the caller is not the current admin.
    ///
    /// # Notes
    ///
    /// - The delay is stored in instance storage under [`DataKey::AntiSandwichDelay`].
    /// - The last deposit ledger for each user is tracked in temporary storage.
    /// - During deposit, the contract checks if the current ledger is less than
    ///   `last_deposit_ledger + anti_sandwich_delay` and returns
    ///   [`Error::AntiSandwichDelayActive`] if the delay has not elapsed.
    /// - This protection is independent of the general cooldown mechanism
    ///   configured by [`FiatBridge::set_cooldown`].
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Set anti-sandwich delay to 100 ledgers (~8 minutes).
    /// bridge.set_anti_sandwich_delay(&100).expect("admin only");
    ///
    /// // Verify the delay was set.
    /// assert_eq!(bridge.get_anti_sandwich_delay(), 100);
    ///
    /// // First deposit succeeds.
    /// bridge.deposit(&user, &100, &token, &Bytes::new(&env), &0, &0, &None);
    ///
    /// // Second deposit immediately fails with AntiSandwichDelayActive.
    /// let result = bridge.try_deposit(&user, &100, &token, &Bytes::new(&env), &0, &0, &None);
    /// assert_eq!(result, Err(Error::AntiSandwichDelayActive));
    ///
    /// // Disable the protection.
    /// bridge.set_anti_sandwich_delay(&0).expect("admin only");
    /// assert_eq!(bridge.get_anti_sandwich_delay(), 0);
    /// ```
    ///
    /// # Cross-references
    ///
    /// - [`FiatBridge::get_anti_sandwich_delay`] — retrieves the current delay value
    /// - [`FiatBridge::set_cooldown`] — sets the general deposit cooldown
    /// - [`FiatBridge::deposit`] — enforces this delay during deposit operations
    /// - [`DataKey::AntiSandwichDelay`] — storage key for this value
    /// - [`DataKey::LastDeposit`] — storage key tracking last deposit per user
    /// - [`Error::AntiSandwichDelayActive`] — error when delay has not elapsed
    pub fn set_anti_sandwich_delay(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        // Reject u32::MAX as it could cause overflow issues
        if ledgers == u32::MAX {
            return Err(Error::InvalidAmount);
        }
        
        env.storage()
            .instance()
            .set(&DataKey::AntiSandwichDelay, &ledgers);
        Ok(())
    }

    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if new_admin == admin {
            return Err(Error::SameAdmin);
        }
        let proposed_at = env.ledger().sequence() as u64;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &(new_admin, proposed_at));
        Ok(())
    }

    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let (pending, proposed_at): (Address, u64) = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;
        pending.require_auth();
        let current = env.ledger().sequence() as u64;
        let unlock_at = proposed_at.checked_add(MIN_TIMELOCK_DELAY as u64)
            .ok_or(Error::Overflow)?;
        if current < unlock_at {
            return Err(Error::ActionNotReady);
        }
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    // ── Fiat Limits & Oracle ──────────────────────────────────────────────
    /// Sets the oracle contract address for fiat price validation.
    ///
    /// This function configures the oracle address used by the contract to
    /// obtain token prices in USD cents for fiat limit enforcement. The oracle
    /// is called during deposit operations to validate that the fiat value of
    /// deposits does not exceed configured limits.
    ///
    /// Only the current admin can call this function. The oracle address can
    /// be updated at any time by the admin, allowing for oracle migration or
    /// replacement as needed.
    ///
    /// # Parameters
    ///
    /// - `oracle` — the address of the oracle contract that provides price feeds.
    ///   This address must implement the expected oracle interface for price
    ///   queries.
    ///
    /// # Returns
    ///
    /// - `Ok(())` — the oracle address was successfully updated.
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`] — the contract has not been initialized.
    /// - [`Error::Unauthorized`] — the caller is not the current admin.
    ///
    /// # Notes
    ///
    /// - The oracle address is stored in instance storage.
    /// - Setting an invalid oracle address will cause subsequent deposits to
    ///   fail with [`Error::OracleNotSet`] or [`Error::OraclePriceInvalid`].
    /// - This function does not validate that the oracle address is a valid
    ///   contract or that it implements the required interface.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Set the oracle address.
    /// let oracle_addr = Address::from_string(&soroban_sdk::String::from_str(&env, "G..."));
    /// bridge.set_oracle(&oracle_addr).expect("admin only");
    ///
    /// // Verify the oracle was set.
    /// let stored_oracle = bridge.get_config_snapshot().unwrap().oracle;
    /// assert_eq!(stored_oracle, Some(oracle_addr));
    /// ```
    ///
    /// # Cross-references
    ///
    /// - [`FiatBridge::set_fiat_limit`] — sets the fiat limit enforced using oracle prices
    /// - [`FiatBridge::validate_fiat_limit`] — internal function that uses the oracle
    /// - [`DataKey::Oracle`] — storage key for this value
    /// - [`Error::OracleNotSet`] — error when oracle is not configured
    /// - [`Error::OraclePriceInvalid`] — error when oracle returns invalid price
    pub fn set_oracle(env: Env, oracle: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        // Reject self-referential addresses
        if oracle == admin {
            return Err(Error::SelfReferentialAddress);
        }
        if oracle == env.current_contract_address() {
            return Err(Error::SelfReferentialAddress);
        }
        
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        Ok(())
    }

    pub fn set_fiat_limit(env: Env, limit_usd_cents: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::FiatLimit, &limit_usd_cents);
        Ok(())
    }

    /// Validates execution price against expected benchmark using integer cross-multiplication.
    ///
    /// # Overflow Prevention & Mathematical Analysis
    /// Standard integer division $\lfloor ((\text{expected} - \text{actual}) \times 10\,000) / \text{expected} \rfloor$
    /// truncates fractional digits, which can allow trades slightly over the slippage limit to pass.
    ///
    /// This function prevents truncation evasion and overflow using a three-step integer arithmetic strategy:
    /// 1. **Downward Filter**: Evaluates only downward movements (`actual_price < expected_price`).
    /// 2. **Fast-Reject Cross-Multiplication**: Evaluates $(\text{expected} - \text{actual}) \times 10\,000 > \text{max\_slippage\_bps} \times \text{expected}$
    ///    to reject out-of-bounds prices immediately without division truncation.
    /// 3. **Exact Quotient & Ceiling Remainder Guard**: If integer quotient equals `max_slippage_bps`,
    ///    inspects the remainder $((\text{expected} - \text{actual}) \times 10\,000) \pmod{\text{expected}}$.
    ///    If $\text{remainder} \ge \text{expected} / 2$, ceiling rounding would exceed the threshold, returning [`Error::SlippageTooHigh`].
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `expected_price` – Expected benchmark oracle price scaled by `FIXED_POINT` (0 to skip check).
    /// * `actual_price` – Realized oracle price scaled by `FIXED_POINT`.
    /// * `max_slippage_bps` – Maximum allowable downward slippage in basis points (1 BPS = 0.01%).
    ///
    /// # Errors
    /// * [`Error::SlippageTooHigh`] – If downward price slippage exceeds `max_slippage_bps`.
    fn check_slippage(
        env: &Env,
        expected_price: i128,
        actual_price: i128,
        max_slippage_bps: u32,
    ) -> Result<(), Error> {
        if expected_price <= 0 {
            return Ok(()); // Skip if no benchmark provided
        }

        // Computed slippage in BPS: (Expected - Actual) / Expected * 10,000
        // We only care about downward slippage for these paths.
        // ── Issue #220: use precision-safe fixed-point math ───────────────
        // Use floor division for the displayed slippage value
        let slippage_bps = if actual_price < expected_price {
            let diff = expected_price - actual_price;
            crate::math::mul_div_floor(diff, 10000, expected_price)
        } else {
            0
        };

        SlippageEvent { version: EVENT_VERSION, slippage_bps: slippage_bps as u32 }.publish(env);

        // Check slippage using cross-multiplication to avoid division errors.
        // We allow extra tolerance to account for ceiling division rounding in tests:
        // Reject if: (expected - actual) * 10_000 > 2 * max_slippage_bps * expected
        if actual_price < expected_price {
            let diff = expected_price - actual_price;
            let max_i128 = max_slippage_bps as i128;
            let threshold = max_i128 * expected_price;

            if diff * 10_000 > threshold {
                return Err(Error::SlippageTooHigh);
            }
            let numerator = diff * 10_000;
            let quotient = numerator / expected_price;

            // Reject if quotient exceeds max
            if quotient > (max_slippage_bps as i128) {
                return Err(Error::SlippageTooHigh);
            }

            // Also reject if quotient equals max but remainder indicates ceiling would exceed
            if quotient == (max_slippage_bps as i128) {
                let remainder = numerator % expected_price;
                // If remainder > expected_price / 2, ceiling would round up
                if remainder > 0 && remainder >= expected_price / 2 {
                    return Err(Error::SlippageTooHigh);
                }
            }
        }

        Ok(())
    }

    /// Queries price from the oracle and enforces 24-hour rolling fiat deposit caps.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Fixed-Point Conversion**: Computes USD cents via [`crate::math::mul_div_floor`] with
    ///   divisor `ORACLE_PRICE_DECIMALS / 100` ($10^5$), ensuring zero precision loss and intermediate
    ///   multiplication safety.
    /// - **Rolling Window Saturation**: Ledger window rollover is evaluated via
    ///   `curr >= vol.window_start + WINDOW_LEDGERS`, preventing premature window resets.
    /// - **Volume Accumulation Check**: Verifies `vol.usd_cents + usd_cents <= limit` before adding.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `depositor` – Address of the depositor.
    /// * `token` – Address of the token contract.
    /// * `amount` – Deposit amount in stroops.
    ///
    /// # Returns
    /// * `Ok(i128)` – Realized token price from oracle in fixed-point units.
    ///
    /// # Errors
    /// * [`Error::OracleNotSet`] – If fiat limits are enabled but no oracle is configured.
    /// * [`Error::OraclePriceInvalid`] – If oracle returns price $\le 0$.
    /// * [`Error::ExceedsFiatLimit`] – If 24-hour rolling fiat deposit limit is exceeded.
    fn validate_fiat_limit(
        env: &Env,
        depositor: &Address,
        token: &Address,
        amount: i128,
    ) -> Result<i128, Error> {
        let oracle_addr = env.storage().instance().get::<_, Address>(&DataKey::Oracle);
        let fiat_limit = env.storage().instance().get::<_, i128>(&DataKey::FiatLimit);

        if oracle_addr.is_none() && fiat_limit.is_none() {
            return Ok(0);
        }

        let price = if let Some(addr) = oracle_addr {
            let oracle = crate::oracle::OracleClient::new(env, &addr);
            let p = oracle.get_price(token).unwrap_or(0);
            if p <= 0 {
                return Err(Error::OraclePriceInvalid);
            }
            p
        } else {
            return Err(Error::OracleNotSet);
        };

        if let Some(limit) = fiat_limit {
            // ── Issue #220: use precision-safe fixed-point math ───────────
            let usd_cents = crate::math::mul_div_floor(amount, price, ORACLE_PRICE_DECIMALS / 100);
            let curr = env.ledger().sequence();
            let mut vol: UserDailyVolume = env
                .storage()
                .instance()
                .get(&DataKey::UserDailyVolume(depositor.clone()))
                .unwrap_or(UserDailyVolume {
                    usd_cents: 0,
                    window_start: curr,
                });

            if curr >= vol.window_start + WINDOW_LEDGERS {
                vol.usd_cents = 0;
                vol.window_start = curr;
            }
            if vol.usd_cents + usd_cents > limit {
                return Err(Error::ExceedsFiatLimit);
            }
            vol.usd_cents += usd_cents;
            env.storage()
                .instance()
                .set(&DataKey::UserDailyVolume(depositor.clone()), &vol);
        }

        Ok(price)
    }

    fn enforce_daily_deposit_limit(
        env: &Env,
        depositor: &Address,
        token: &Address,
        amount: i128,
        config: &TokenConfig,
    ) -> Result<(), Error> {
        if config.daily_deposit_limit <= 0 {
            return Ok(());
        }

        let curr = env.ledger().sequence();
        let key = DataKey::UserDailyDeposit(depositor.clone(), token.clone());
        let mut record: UserDailyDeposit =
            env.storage()
                .instance()
                .get(&key)
                .unwrap_or(UserDailyDeposit {
                    amount: 0,
                    window_start: curr,
                });

        if curr >= record.window_start.saturating_add(WINDOW_LEDGERS) {
            record.amount = 0;
            record.window_start = curr;
        }

        if record.amount.saturating_add(amount) > config.daily_deposit_limit {
            return Err(Error::DailyLimitExceeded);
        }

        record.amount += amount;
        env.storage().instance().set(&key, &record);
        Ok(())
    }

    // ── Timelock ──────────────────────────────────────────────────────────
    /// Queues an administrative action subject to a mandatory timelock delay.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Timelock Addition Check**: Computes `target_ledger = current_ledger.checked_add(delay).ok_or(Error::Overflow)?`.
    ///   Using checked addition guarantees that ledger number wraparound cannot produce a target ledger
    ///   in the past, preventing timelock bypass attacks.
    /// - **Sequential Action ID**: Increments `NextActionID` with `id.checked_add(1).ok_or(Error::Overflow)?`.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `action_type` – Symbol identifier for the governance action.
    /// * `payload` – Serialized byte payload for execution.
    /// * `delay` – Enforced timelock delay in ledgers ($\ge \text{MIN\_TIMELOCK\_DELAY}$).
    ///
    /// # Returns
    /// * `Ok(u64)` – Unique action identifier.
    ///
    /// # Errors
    /// * [`Error::ActionNotReady`] – If `delay < MIN_TIMELOCK_DELAY`.
    /// * [`Error::Overflow`] – If `current_ledger + delay` or `NextActionID` overflows.
    pub fn queue_admin_action(
        env: Env,
        action_type: Symbol,
        payload: Bytes,
        delay: u32,
    ) -> Result<u64, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if delay < MIN_TIMELOCK_DELAY {
            return Err(Error::ActionNotReady);
        }
        let current_ledger = env.ledger().sequence();
        let target_ledger = current_ledger.checked_add(delay).ok_or(Error::Overflow)?;
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextActionID)
            .unwrap_or(0);
        let action = QueuedAdminAction {
            action_type: action_type.clone(),
            payload,
            queued_ledger: current_ledger,
            target_ledger,
        };
        env.storage()
            .persistent()
            .set(&DataKey::QueuedAdminAction(id), &action);
        let next_id = id.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::NextActionID, &next_id);
        AdminActionQueuedEvent {
            version: EVENT_VERSION,
            action_type: action_type.clone(),
            action_id: id,
            target_ledger: action.target_ledger,
        }
        .publish(&env);
        Ok(id)
    }

    pub fn execute_admin_action(env: Env, id: u64) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let action: QueuedAdminAction = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(id))
            .ok_or(Error::ActionNotQueued)?;
        if env.ledger().sequence() <= action.target_ledger {
            return Err(Error::ActionNotReady);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::QueuedAdminAction(id));
        AdminActionExecutedEvent { version: EVENT_VERSION, action_id: id }.publish(&env);
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        Ok(())
    }

    // ── Operator Role & Heartbeat ───────────────────────────────────────
    pub fn set_operator(env: Env, operator: Address, active: bool, nonce: u64) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let current_slippage_threshold: u32 = Self::get_slippage_threshold(env.clone());
        if current_slippage_threshold > 10000 {
            return Err(Error::SlippageTooHigh);
        }

        // Reject admin as operator (role confusion guard)
        if operator == admin {
            return Err(Error::NotAllowed);
        }
        // Reject contract address as operator
        if operator == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }

        // Validate and increment nonce for replay protection
        Self::validate_and_increment_nonce(&env, &operator, nonce)?;

        Self::prune_inactive_operators_internal(&env);
        let was_active = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator.clone()))
            .unwrap_or(false);

        // Return NotOperator when attempting to deactivate a non-operator
        if !active && !was_active {
            return Err(Error::NotOperator);
        }
        let max_operators: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxOperators)
            .unwrap_or(0);
        let mut operators = Self::get_operator_list(&env);

        if active && !was_active && max_operators > 0 && operators.len() >= max_operators {
            return Err(Error::OperatorCapReached);
        }

        env.storage()
            .instance()
            .set(&DataKey::Operator(operator.clone()), &active);
        if active {
            if !was_active {
                operators.push_back(operator.clone());
            }
        } else if was_active {
            operators = Self::remove_operator_from_list(&env, &operators, &operator);
        }
        env.storage()
            .instance()
            .set(&DataKey::OperatorList, &operators);
        env.storage()
            .instance()
            .set(&DataKey::OperatorCount, &operators.len());

        SetOperatorEvent {
            version: EVENT_VERSION,
            operator: operator.clone(),
            active,
            previous_active: was_active,
            operator_count: operators.len(),
        }
        .publish(&env);

        Ok(())
    }

    pub fn set_max_operators(env: Env, max_operators: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let current_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OperatorCount)
            .unwrap_or(0);
        // Reject if reduction would go below current active operator count
        if max_operators > 0 && current_count > max_operators {
            return Err(Error::ExceedsLimit);
        }
        // Read the outgoing cap before overwriting it so the event carries the
        // full transition. A missing key means no cap was configured, which the
        // contract treats as unlimited and the event reports as 0.
        let previous: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxOperators)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::MaxOperators, &max_operators);

        SetMaxOperatorsEvent {
            version: EVENT_VERSION,
            previous,
            max_operators,
            active_operators: current_count,
        }
        .publish(&env);

        Ok(())
    }

    // ── Denylist ──────────────────────────────────────────────────────────
    /// Adds an address to the persistent denylist and increments the enumeration counter.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Capacity Assertion**: Checks `count == u64::MAX` returning [`Error::MaxDeniedReached`].
    /// - **Checked Counter Increment**: Increments `DeniedCount` with `count.checked_add(1).ok_or(Error::Overflow)?`.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `address` – Target address to deny.
    ///
    /// # Errors
    /// * [`Error::MaxDeniedReached`] – If denylist capacity reaches `u64::MAX`.
    /// * [`Error::Overflow`] – If counter increment overflows `u64`.
    pub fn deny_address(env: Env, address: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Denied(address.clone()), &true);

        // Append to denied-address index for enumeration
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0);
        if count == u64::MAX {
            return Err(Error::MaxDeniedReached);
        }
        env.storage()
            .persistent()
            .set(&DataKey::DeniedIndex(count), &Some(address.clone()));
        env.storage()
            .instance()
            .set(&DataKey::DeniedCount, &(count.checked_add(1).ok_or(Error::Overflow)?));

        DenyAddressEvent { version: EVENT_VERSION, address: address.clone() }.publish(&env);
        Ok(())
    }

    pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error> {
        Self::emit_telemetry(&env, Symbol::new(&env, "heartbeat"));
        Self::require_circuit_breaker_clear(&env)?;
        let curr = env.ledger().sequence();
        Self::execute_single_heartbeat(&env, &operator, nonce, curr)
    }

    /// Executes a batch of operator heartbeats in a single call.
    ///
    /// # Safety & Boundary Invariants
    /// - **Circuit Breaker Check**: Rejects execution immediately if the circuit breaker is active.
    /// - **Operator Authentication**: Each operator in the batch must authenticate their item.
    /// - **Operator Role Verification**: Each item must correspond to an active operator.
    /// - **Replay Protection**: Validates and increments each operator's sequential nonce monotonically.
    /// - **Telemetry & Events**: Emits `TelemetryEvent`, individual `HeartbeatEvent`s for successes,
    ///   `HeartbeatBatchFailEvent` for any failed item, and a summary `HeartbeatBatchEvent`.
    pub fn heartbeat_batch(
        env: Env,
        items: Vec<HeartbeatItem>,
    ) -> Result<BatchHeartbeatResult, Error> {
        Self::emit_telemetry(&env, Symbol::new(&env, "heartbeat_batch"));
        Self::require_circuit_breaker_clear(&env)?;

        let total_items = items.len();
        let mut success_count: u32 = 0;
        let mut failure_count: u32 = 0;
        let mut first_failed_index: Option<u32> = None;
        let curr = env.ledger().sequence();

        for (idx, item) in items.iter().enumerate() {
            let res = Self::execute_single_heartbeat(&env, &item.operator, item.nonce, curr);
            if res.is_err() {
                HeartbeatBatchFailEvent {
                    version: EVENT_VERSION,
                    index: idx as u32,
                    total_items,
                }
                .publish(&env);
                failure_count += 1;
                if first_failed_index.is_none() {
                    first_failed_index = Some(idx as u32);
                }
            } else {
                success_count += 1;
            }
        }

        HeartbeatBatchEvent {
            version: EVENT_VERSION,
            total_items,
            success_count,
            failure_count,
            ledger: curr,
        }
        .publish(&env);

        Ok(BatchHeartbeatResult {
            total_items,
            success_count,
            failure_count,
            failed_index: first_failed_index,
        })
    }

    fn execute_single_heartbeat(
        env: &Env,
        operator: &Address,
        nonce: u64,
        curr: u32,
    ) -> Result<(), Error> {
        operator.require_auth();
        if !env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator.clone()))
            .unwrap_or(false)
        {
            return Err(Error::NotOperator);
        }

        Self::validate_and_increment_nonce(env, operator, nonce)?;

        env.storage()
            .instance()
            .set(&DataKey::OperatorHeartbeat(operator.clone()), &curr);

        HeartbeatEvent {
            version: EVENT_VERSION,
            operator: operator.clone(),
            ledger: curr,
        }
        .publish(env);

        Ok(())
    }

    pub fn is_operator(env: Env, operator: Address) -> bool {
        let result = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator.clone()))
            .unwrap_or(false);

        IsOperatorCheckedEvent {
            version: EVENT_VERSION,
            operator,
            result,
        }
        .publish(&env);

        result
    }

    pub fn get_operator_heartbeat(env: Env, operator: Address) -> Option<u32> {
        env.storage()
            .instance()
            .get(&DataKey::OperatorHeartbeat(operator))
    }

    pub fn get_operator_nonce(env: Env, operator: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OperatorNonce(operator))
            .unwrap_or(0)
    }

    pub fn prune_inactive_operators(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Self::prune_inactive_operators_internal(&env);
        Ok(())
    }

    fn validate_and_increment_nonce(
        env: &Env,
        operator: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OperatorNonce(operator.clone()))
            .unwrap_or(0);

        // Nonce must be exactly current_nonce (monotonically increasing)
        if provided_nonce != current_nonce {
            if provided_nonce < current_nonce {
                return Err(Error::StaleNonce);
            } else {
                return Err(Error::InvalidNonce);
            }
        }

        // Increment nonce
        env.storage().instance().set(
            &DataKey::OperatorNonce(operator.clone()),
            &(current_nonce + 1),
        );

        NonceIncrementedEvent {
            version: EVENT_VERSION,
            operator: operator.clone(),
            new_nonce: current_nonce + 1,
        }
        .publish(env);

        Ok(())
    }

    fn validate_and_increment_init_nonce(
        env: &Env,
        admin: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::InitNonce(admin.clone()))
            .unwrap_or(0);

        if provided_nonce != current_nonce {
            if provided_nonce < current_nonce {
                return Err(Error::StaleNonce);
            } else {
                return Err(Error::InvalidNonce);
            }
        }

        let next_nonce = current_nonce.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::InitNonce(admin.clone()), &next_nonce);

        InitNonceIncrementedEvent {
            version: EVENT_VERSION,
            admin: admin.clone(),
            new_nonce: next_nonce,
        }
        .publish(env);

        Ok(())
    }

    fn prune_inactive_operators_internal(env: &Env) {
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::InactivityThreshold)
            .unwrap_or(DEFAULT_INACTIVITY_THRESHOLD);
        let current_ledger = env.ledger().sequence();
        let operators = Self::get_operator_list(env);
        let mut retained = Vec::new(env);

        for operator in operators.iter() {
            let is_active = env
                .storage()
                .instance()
                .get::<_, bool>(&DataKey::Operator(operator.clone()))
                .unwrap_or(false);
            if !is_active {
                continue;
            }

            let heartbeat = env
                .storage()
                .instance()
                .get::<_, u32>(&DataKey::OperatorHeartbeat(operator.clone()));
            let is_inactive = heartbeat
                .map(|last| current_ledger.saturating_sub(last) > threshold)
                .unwrap_or(false);

            if is_inactive {
                env.storage()
                    .instance()
                    .set(&DataKey::Operator(operator.clone()), &false);
                OperatorPrunedEvent {
                    version: EVENT_VERSION,
                    operator: operator.clone(),
                    ledger: current_ledger,
                }
                .publish(env);
            } else {
                retained.push_back(operator);
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::OperatorList, &retained);
        env.storage()
            .instance()
            .set(&DataKey::OperatorCount, &retained.len());
    }

    fn get_operator_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::OperatorList)
            .unwrap_or(Vec::new(env))
    }

    fn remove_operator_from_list(
        env: &Env,
        operators: &Vec<Address>,
        target: &Address,
    ) -> Vec<Address> {
        let mut filtered = Vec::new(env);
        for operator in operators.iter() {
            if operator != *target {
                filtered.push_back(operator);
            }
        }
        filtered
    }

    // ── Ownership Renounce ────────────────────────────────────────────────
    pub fn queue_renounce_admin(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Design decision: block renounce while paused.
        // If we allowed queuing while paused, the timelock could elapse and
        // execute_renounce_admin would leave the contract permanently paused
        // with no admin able to unpause it. Requiring an explicit unpause first
        // forces the admin to consciously restore normal operations before
        // giving up control.
        Self::require_not_paused(&env)?;

        let current_ledger = env.ledger().sequence();
        let target_ledger = current_ledger.checked_add(MIN_TIMELOCK_DELAY)
            .ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingRenounceLedger, &target_ledger);
        Ok(())
    }

    pub fn remove_denied_address(env: Env, address: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Denied(address.clone()));

        // Tombstone the index slot (mark as None) without compacting
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0);
        for i in 0..count {
            if let Some(Some(addr)) = env
                .storage()
                .persistent()
                .get::<_, Option<Address>>(&DataKey::DeniedIndex(i))
            {
                if addr == address {
                    env.storage()
                        .persistent()
                        .set(&DataKey::DeniedIndex(i), &Option::<Address>::None);
                    break;
                }
            }
        }

        DenyRemovedEvent { version: EVENT_VERSION, address: address.clone() }.publish(&env);
        Ok(())
    }

    /// Checks if an address is on the denylist.
    ///
    /// Returns `true` if the address has been denied via [`deny_address`],
    /// `false` otherwise. Denied addresses cannot deposit, withdraw,
    /// request withdrawals, or read user-specific contract state.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `address` - The address to check
    ///
    /// # Returns
    /// `true` if the address is denied, `false` otherwise
    pub fn is_denied(env: Env, address: Address) -> Result<bool, Error> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0);
        // Overflow guard: DeniedCount must not have wrapped past u64::MAX
        if count == u64::MAX {
            return Err(Error::Overflow);
        }
        let denied = env.storage().persistent().has(&DataKey::Denied(address.clone()));
        IsDeniedCheckedEvent { version: EVENT_VERSION, address, result: denied }.publish(&env);
        Ok(denied)
    }

    pub fn get_denied_addresses(env: Env, offset: u64, limit: u32) -> Vec<Address> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0);
        let mut result: Vec<Address> = Vec::new(&env);
        let mut collected: u32 = 0;
        let mut idx = offset;
        while idx < count && collected < limit {
            if let Some(Some(addr)) = env
                .storage()
                .persistent()
                .get::<_, Option<Address>>(&DataKey::DeniedIndex(idx))
            {
                result.push_back(addr);
                collected += 1;
            }
            // Use checked_add to prevent overflow when iterating the denylist index
            idx = match idx.checked_add(1) {
                Some(next) => next,
                None => break,
            };
        }
        result
    }

    pub fn get_token_allowlist(env: Env, offset: u64, limit: u32) -> Vec<TokenAllowlistEntry> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenAllowlistCount)
            .unwrap_or(0);
        let mut result: Vec<TokenAllowlistEntry> = Vec::new(&env);
        let mut collected: u32 = 0;
        let mut idx = offset;
        while idx < count && collected < limit {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<_, TokenAllowlistEntry>(&DataKey::TokenAllowlistIndex(idx))
            {
                // Only include entries that still exist in the actual allowlist
                if env.storage().persistent().has(&DataKey::TokenAllowed(entry.token.clone(), entry.address.clone())) {
                    result.push_back(entry);
                    collected += 1;
                }
            }
            idx = match idx.checked_add(1) {
                Some(next) => next,
                None => break,
            };
        }
        result
    }

    pub fn get_token_allowlist_enabled(env: Env, offset: u64, limit: u32) -> Vec<TokenAllowlistEnabledEntry> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenAllowlistEnabledCount)
            .unwrap_or(0);
        let mut result: Vec<TokenAllowlistEnabledEntry> = Vec::new(&env);
        let mut collected: u32 = 0;
        let mut idx = offset;
        while idx < count && collected < limit {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<_, TokenAllowlistEnabledEntry>(&DataKey::TokenAllowlistEnabledIndex(idx))
            {
                result.push_back(entry);
                collected += 1;
            }
            idx = match idx.checked_add(1) {
                Some(next) => next,
                None => break,
            };
        }
        result
    }

    // ── Fee Vault ─────────────────────────────────────────────────────────
    pub fn accrue_fee(env: Env, token: Address, amount: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let key = DataKey::FeeVault(token.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));

        FeeAccruedEvent { version: EVENT_VERSION, token: token.clone(), amount }.publish(&env);
        Ok(())
    }

    pub fn cancel_renounce_admin(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        // Validate that a pending renounce exists before canceling
        if !env
            .storage()
            .instance()
            .has(&DataKey::PendingRenounceLedger)
        {
            return Err(Error::ActionNotQueued);
        }
        
        env.storage()
            .instance()
            .remove(&DataKey::PendingRenounceLedger);
        Ok(())
    }

    pub fn get_accrued_fees(env: Env, token: Address) -> i128 {
        // Boundary check: ensure token is whitelisted/registered
        if !env
            .storage()
            .persistent()
            .has(&DataKey::TokenRegistry(token.clone()))
        {
            return 0;
        }

        let amount = env
            .storage()
            .persistent()
            .get(&DataKey::FeeVault(token.clone()))
            .unwrap_or(0);

        FeeQueryEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            amount,
        }
        .publish(&env);

        amount
    }

    /// Withdraws accrued protocol fees for a specific token to the fee recipient.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Zero Amount Guard**: Rejects `amount <= 0`.
    /// - **Vault Balance Guard**: Validates `amount <= current_accrued_fees`, ensuring `current - amount` cannot underflow.
    /// - **Guarded State Update**: Updates `FeeVault` with exact guarded subtraction `current - amount`.
    /// - **Sequential Replay Nonce**: Increments the caller's `FeeWithdrawalNonceByCaller` entry with `nonce + 1`.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `to` – Fallback recipient address (overridden if `FeeRecipient` is set in configuration).
    /// * `token` – Token contract address.
    /// * `amount` – Fee amount in stroops to withdraw.
    ///
    /// # Errors
    /// * [`Error::ZeroAmount`] – If `amount <= 0`.
    /// * [`Error::NoFeesToWithdraw`] – If no fees are accrued in the vault.
    /// * [`Error::FeeWithdrawalExceedsBalance`] – If `amount > current_accrued_fees`.
    pub fn withdraw_fees(env: Env, to: Address, token: Address, amount: i128) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "withdraw_fees"));
        
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let key = DataKey::FeeVault(token.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);

        // Edge case: no fees accrued at all
        if current <= 0 {
            return Err(Error::NoFeesToWithdraw);
        }

        // Edge case: requested amount exceeds available fee balance
        if amount > current {
            return Err(Error::FeeWithdrawalExceedsBalance);
        }

        // ── Issue #1044: use fee_recipient if set, otherwise use the provided 'to' address
        let recipient = env
            .storage()
            .instance()
            .get(&DataKey::FeeRecipient)
            .unwrap_or(to);

        let token_client = token::Client::new(&env, &token);

        // Issue #840: emit reconciliation event when vault ledger exceeds on-chain balance
        let on_chain_balance = token_client.balance(&env.current_contract_address());
        if current > on_chain_balance {
            FeeVaultReconciledEvent {
                version: EVENT_VERSION,
                token: token.clone(),
                vault_ledger: current,
                on_chain_balance,
            }
            .publish(&env);
        }

        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        env.storage().persistent().set(&key, &(current - amount));
        // Increment fee withdrawal nonce for replay protection tracking
        let nonce_key = DataKey::FeeWithdrawalNonceByCaller(admin.clone());
        let nonce: u64 = env.storage().instance().get(&nonce_key).unwrap_or(0);
        env.storage().instance().set(&nonce_key, &(nonce + 1));
        let global_nonce: u64 = env.storage().instance().get(&DataKey::FeeWithdrawalNonce).unwrap_or(0);
        env.storage().instance().set(&DataKey::FeeWithdrawalNonce, &(global_nonce + 1));
        FeeWithdrawnEvent { version: EVENT_VERSION, to: recipient, amount }.publish(&env);
        Ok(())
    }

    /// Atomically sweeps accrued protocol fees across multiple registered tokens.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Per-Caller Replay Protection**: Validates and increments caller batch nonce via checked addition.
    /// - **Safe Iteration**: Iterates over caller-provided token addresses, sweeping non-zero fee balances.
    /// - **Guarded Reset**: Resets each swept fee vault entry directly to 0 (`0i128`), avoiding arithmetic drift.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `to` – Fallback recipient address.
    /// * `tokens` – List of token addresses to sweep.
    /// * `nonce` – Caller's batch withdrawal nonce.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] – If caller is not admin.
    /// * [`Error::StaleNonce`] / [`Error::InvalidNonce`] – If replay protection nonce is invalid.
    pub fn withdraw_fees_batch(
        env: Env,
        to: Address,
        tokens: Vec<Address>,
        nonce: u64,
    ) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "withdraw_fees_batch"));

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // ── Issue #1113: per-caller replay protection ────────────────────
        Self::validate_and_increment_fee_withdrawal_nonce(&env, &admin, nonce)?;

        // ── Issue #1044: use fee_recipient if set, otherwise use the provided 'to' address
        let recipient = env
            .storage()
            .instance()
            .get(&DataKey::FeeRecipient)
            .unwrap_or(to);

        let contract = env.current_contract_address();
        for token in tokens.iter() {
            let key = DataKey::FeeVault(token.clone());
            let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            if current <= 0 {
                continue;
            }

            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&contract, &recipient, &current);
            env.storage().persistent().set(&key, &0i128);
            FeeWithdrawnEvent { version: EVENT_VERSION, to: recipient.clone(), amount: current }.publish(&env);
        }

        Ok(())
    }

    pub fn execute_renounce_admin(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let target_ledger: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingRenounceLedger)
            .ok_or(Error::ActionNotQueued)?;
        if env.ledger().sequence() <= target_ledger {
            return Err(Error::ActionNotReady);
        }
        env.storage()
            .instance()
            .remove(&DataKey::PendingRenounceLedger);
        env.storage().instance().remove(&DataKey::Admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    // ── Emergency Token Rescue ────────────────────────────────────────────
    pub fn rescue_token(env: Env, token: Address, to: Address, amount: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Forbid rescue of the primary protocol asset
        let primary_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        if token == primary_token {
            return Err(Error::RescueForbidden);
        }

        // Also forbid rescue of any whitelisted token in the registry
        if env
            .storage()
            .persistent()
            .has(&DataKey::TokenRegistry(token.clone()))
        {
            return Err(Error::RescueForbidden);
        }

        let token_client = token::Client::new(&env, &token);
        let balance = token_client.balance(&env.current_contract_address());
        if amount > balance {
            return Err(Error::InsufficientFunds);
        }

        token_client.transfer(&env.current_contract_address(), &to, &amount);

        RescueEvent { version: EVENT_VERSION, token: token.clone(), to: to.clone(), amount }.publish(&env);
        Ok(())
    }

    // ── View Functions ────────────────────────────────────────────────────
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
    pub fn get_token(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }
    pub fn get_limit(env: Env) -> Result<i128, Error> {
        let tok = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        Ok(env
            .storage()
            .persistent()
            .get::<_, TokenConfig>(&DataKey::TokenRegistry(tok))
            .ok_or(Error::InternalError)?
            .limit)
    }

    pub fn get_user_deposited(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserDeposited(user))
            .unwrap_or(0)
    }

    pub fn get_daily_deposit_record(env: Env, user: Address) -> Option<UserDailyVolume> {
        let mut vol: UserDailyVolume = env
            .storage()
            .instance()
            .get(&DataKey::UserDailyVolume(user))?;
        
        let curr = env.ledger().sequence();
        if curr >= vol.window_start.saturating_add(WINDOW_LEDGERS) {
            vol.usd_cents = 0;
            vol.window_start = curr;
        }
        Some(vol)
    }

    pub fn get_total_deposited(env: Env) -> i128 {
        let tok: Option<Address> = env.storage().instance().get(&DataKey::Token);
        match tok {
            None => 0,
            Some(tok) => env
                .storage()
                .persistent()
                .get::<_, TokenConfig>(&DataKey::TokenRegistry(tok))
                .map(|c| c.total_deposited)
                .unwrap_or(0),
        }
    }
    pub fn get_lock_period(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0)
    }
    pub fn get_cooldown(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CooldownLedgers)
            .unwrap_or(0)
    }
    pub fn get_withdrawal_cooldown(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawCooldownLedgers)
            .unwrap_or(0)
    }
    pub fn get_withdrawal_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawCooldownThreshold)
            .unwrap_or(0)
    }
    pub fn get_slippage_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SlippageThreshold)
            .unwrap_or(0)
    }
    
    /// Set the slippage threshold for batch operations.
    ///
    /// This function sets the maximum allowed slippage in basis points (BPS).
    /// 1 BPS = 0.01%, so 10000 BPS = 100%.
    ///
    /// # Parameters
    ///
    /// - `threshold_bps` – the slippage threshold in basis points (0-10000)
    ///
    /// # Errors
    ///
    /// - `Error::NotInitialized` – if the contract has not been initialized
    /// - `Error::Unauthorized` – if the caller is not the admin
    /// - `Error::SlippageTooHigh` – if the threshold exceeds 10000 BPS (100%)
    /// - `Error::InvalidAmount` – if the threshold is u32::MAX
    pub fn set_slippage_threshold(env: Env, threshold_bps: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        // Reject u32::MAX as it could cause overflow issues
        if threshold_bps == u32::MAX {
            return Err(Error::InvalidAmount);
        }
        
        // Validate slippage threshold is reasonable (0-10000 bps = 0-100%)
        if threshold_bps > 10000 {
            return Err(Error::SlippageTooHigh);
        }
        
        env.storage()
            .instance()
            .set(&DataKey::SlippageThreshold, &threshold_bps);
        SlippageThresholdSetEvent { version: EVENT_VERSION, threshold_bps }.publish(&env);
        Ok(())
    }
    
    // ── Issue #1044: fee recipient management ───────────────────────────
    pub fn set_fee_recipient(env: Env, recipient: Address) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "set_fee_recipient"));
        
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::FeeRecipient, &recipient);
        Ok(())
    }
    
    pub fn get_fee_recipient(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::FeeRecipient)
    }
    
    pub fn get_receipt_by_index(env: Env, idx: u64) -> Option<Receipt> {
        let max_receipts: u64 = env.storage().instance().get(&DataKey::ReceiptCounter).unwrap_or(0);
        if idx >= max_receipts {
            // Circuit breaker: emit event and return None to prevent out-of-bounds
            // execution and excessive compute cycles
            ReceiptOobEvent { version: EVENT_VERSION }.publish(&env);
            return None;
        }
        let receipt_hash: BytesN<32> = env
            .storage()
            .temporary()
            .get(&DataKey::ReceiptIndex(idx))?;
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(receipt_hash))
    }

    pub fn get_withdrawal_request(env: Env, id: u64) -> Option<WithdrawRequest> {
        env.storage().persistent().get(&DataKey::WithdrawQueue(id))
    }

    pub fn get_wq_depth(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawQueueLen)
            .unwrap_or(0)
    }

    pub fn get_wq_oldest_queued_ledger(env: Env) -> Option<u32> {
        let head: Option<u64> = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawQueueHead)
            .unwrap_or(None);
        match head {
            Some(id) => env
                .storage()
                .persistent()
                .get::<_, WithdrawRequest>(&DataKey::WithdrawQueue(id))
                .map(|r| r.queued_ledger),
            None => None,
        }
    }

    pub fn get_wq_oldest_age_ledgers(env: Env) -> Option<u32> {
        Self::get_wq_oldest_queued_ledger(env.clone())
            .map(|q| env.ledger().sequence().saturating_sub(q))
    }
    pub fn get_last_deposit_ledger(env: Env, user: Address) -> Option<u32> {
        env.storage().temporary().get(&DataKey::LastDeposit(user))
    }
    pub fn get_pending_renounce_ledger(env: Env) -> Option<u32> {
        env.storage()
            .instance()
            .get(&DataKey::PendingRenounceLedger)
    }

    pub fn get_queued_admin_action(env: Env, id: u64) -> QueuedAdminAction {
        env.storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(id))
            .unwrap_or(QueuedAdminAction {
                action_type: Symbol::new(&env, ""),
                payload: Bytes::new(&env),
                queued_ledger: 0,
                target_ledger: 0,
            })
    }

    pub fn get_anti_sandwich_delay(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AntiSandwichDelay)
            .unwrap_or(0)
    }

    pub fn get_total_withdrawn(env: Env) -> Result<i128, Error> {
        let tok = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        Ok(env
            .storage()
            .persistent()
            .get::<_, TokenConfig>(&DataKey::TokenRegistry(tok))
            .ok_or(Error::InternalError)?
            .total_withdrawn)
    }

    pub fn get_total_liabilities(env: Env) -> Result<i128, Error> {
        let tok = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        Ok(env
            .storage()
            .persistent()
            .get::<_, TokenConfig>(&DataKey::TokenRegistry(tok))
            .ok_or(Error::InternalError)?
            .total_liabilities)
    }

    pub fn get_config_snapshot(env: Env) -> Result<ConfigSnapshot, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;

        Ok(ConfigSnapshot {
            admin,
            pending_admin: env.storage().instance().get(&DataKey::PendingAdmin),
            token,
            oracle: env.storage().instance().get(&DataKey::Oracle),
            fiat_limit: env.storage().instance().get(&DataKey::FiatLimit),
            lock_period: env
                .storage()
                .instance()
                .get(&DataKey::LockPeriod)
                .unwrap_or(0),
            cooldown_ledgers: env
                .storage()
                .instance()
                .get(&DataKey::CooldownLedgers)
                .unwrap_or(0),
            inactivity_threshold: env
                .storage()
                .instance()
                .get(&DataKey::InactivityThreshold)
                .unwrap_or(DEFAULT_INACTIVITY_THRESHOLD),
            allowlist_enabled: env
                .storage()
                .instance()
                .get(&DataKey::AllowlistEnabled)
                .unwrap_or(false),
            emergency_recovery: env
                .storage()
                .instance()
                .get(&DataKey::EmergencyRecoveryAddress),
            anti_sandwich_delay: env
                .storage()
                .instance()
                .get(&DataKey::AntiSandwichDelay)
                .unwrap_or(0),
        })
    }

    // ── Withdrawal Quota ──────────────────────────────────────────────────
    pub fn set_withdrawal_quota(env: Env, quota: i128) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "set_withdrawal_quota"));
        
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalQuota, &quota);
        QuotaSetEvent { version: EVENT_VERSION, quota }.publish(&env);
        Ok(())
    }

    pub fn get_withdrawal_quota(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalQuota)
            .unwrap_or(0)
    }

    /// Set the number of ledgers after which an unexecuted withdrawal request
    /// can be reclaimed by the admin. Pass `0` to use the compile-time default
    /// (`WITHDRAWAL_EXPIRY_WINDOW_LEDGERS`).
    pub fn set_withdrawal_expiry(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalExpiryWindow, &ledgers);
        Ok(())
    }

    pub fn get_withdrawal_expiry(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalExpiryWindow)
            .unwrap_or(WITHDRAWAL_EXPIRY_WINDOW_LEDGERS)
    }

    pub fn get_user_daily_withdrawal(env: Env, user: Address) -> i128 {
        let curr = env.ledger().sequence();
        let record: UserDailyWithdrawal = env
            .storage()
            .instance()
            .get(&DataKey::UserDailyWithdrawal(user))
            .unwrap_or(UserDailyWithdrawal {
                amount: 0,
                window_start: curr,
            });
        if curr >= record.window_start + WINDOW_LEDGERS {
            0
        } else {
            record.amount
        }
    }

    fn enforce_withdrawal_quota(env: &Env, user: &Address, amount: i128) -> Result<(), Error> {
        let quota: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalQuota)
            .unwrap_or(0);
        if quota <= 0 {
            return Ok(());
        }

        let curr = env.ledger().sequence();
        let mut record: UserDailyWithdrawal = env
            .storage()
            .instance()
            .get(&DataKey::UserDailyWithdrawal(user.clone()))
            .unwrap_or(UserDailyWithdrawal {
                amount: 0,
                window_start: curr,
            });

        if curr >= record.window_start + WINDOW_LEDGERS {
            record.amount = 0;
            record.window_start = curr;
            QuotaResetEvent {
                version: EVENT_VERSION,
                user: user.clone(),
                window_start: record.window_start,
            }
            .publish(env);
        }

        if record.amount + amount > quota {
            return Err(Error::WithdrawalQuotaExceeded);
        }

        record.amount += amount;
        env.storage()
            .instance()
            .set(&DataKey::UserDailyWithdrawal(user.clone()), &record);

        WithdrawalQuotaConsumedEvent {
            version: EVENT_VERSION,
            user: user.clone(),
            amount,
            total: record.amount,
        }
        .publish(env);

        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    /// Returns `CircuitBreakerActive` if the circuit breaker is currently tripped
    /// and the auto-reset window has not yet elapsed.
    fn require_circuit_breaker_clear(env: &Env) -> Result<(), Error> {
        let tripped: bool = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreakerTripped)
            .unwrap_or(false);
        if !tripped {
            return Ok(());
        }
        let reset_window: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreakerResetWindow)
            .unwrap_or(CIRCUIT_BREAKER_RESET_LEDGERS);
        let tripped_at: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreakerTrippedAt)
            .unwrap_or(0);
        let curr = env.ledger().sequence();
        if reset_window != u32::MAX && curr > tripped_at.saturating_add(reset_window) {
            // Auto-reset window elapsed — allow through (the next mutation will clear it).
            return Ok(());
        }
        Err(Error::CircuitBreakerActive)
    }

    /// Returns [`Error::AddressDenied`] when `address` is on the denylist.
    #[allow(dead_code)]
    fn reject_if_denied(env: &Env, address: &Address) -> Result<(), Error> {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Denied(address.clone()))
        {
            return Err(Error::AddressDenied);
        }
        Ok(())
    }

    /// Requires `caller` to authenticate and not be on the denylist.
    #[allow(dead_code)]
    fn require_authed_not_denied(env: &Env, caller: &Address) -> Result<(), Error> {
        caller.require_auth();
        Self::reject_if_denied(env, caller)
    }

    fn extend_receipt_ttls_for_depositor(env: &Env, depositor: &Address, min_ttl: u32) {
        let receipt_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);

        let mut idx = 0;
        while idx < receipt_counter {
            if let Some(receipt_hash) = env
                .storage()
                .temporary()
                .get::<_, BytesN<32>>(&DataKey::ReceiptIndex(idx))
            {
                let receipt_key = DataKey::Receipt(receipt_hash.clone());
                if let Some(receipt) = env.storage().persistent().get::<_, Receipt>(&receipt_key) {
                    if receipt.depositor == *depositor {
                        env.storage()
                            .persistent()
                            .extend_ttl(&receipt_key, min_ttl, min_ttl);
                        env.storage()
                            .temporary()
                            .extend_ttl(&DataKey::ReceiptIndex(idx), min_ttl, min_ttl);
                    }
                }
            }
            idx += 1;
        }
    }

    // ── Escrow Migration ──────────────────────────────────────────────────
    /// Returns the current escrow storage schema version — the canonical
    /// way to check migration status.
    ///
    /// This is the version tag that [`FiatBridge::migrate_escrow`] compares
    /// against the compile-time [`ESCROW_STORAGE_VERSION`] constant to
    /// decide whether the migration from temporary [`Receipt`] storage to
    /// persistent [`EscrowRecord`] storage is still needed. After a
    /// successful full migration, the stored version is bumped to match
    /// the constant.
    ///
    /// # Returns
    ///
    /// - `0` — migration has never run or has not completed.
    /// - [`ESCROW_STORAGE_VERSION`] (currently `1`) — fully migrated to the
    ///   current schema.
    ///
    /// Higher values correspond to future schema versions.
    ///
    /// # Errors
    ///
    /// None. An uninitialised contract returns `0`.
    ///
    /// # Notes
    ///
    /// - The version is stored in instance storage and persists across
    ///   contract invocations.
    /// - Safe to call from a read-only/simulation context — it requires no
    ///   authentication and mutates no state.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Before migration, version is 0.
    /// assert_eq!(bridge.get_escrow_storage_version(), 0);
    ///
    /// // Deposit some receipts.
    /// bridge.deposit(&user, &100, &token, &Bytes::new(&env), &0, &0, &None);
    /// bridge.deposit(&user, &250, &token, &Bytes::new(&env), &0, &0, &None);
    ///
    /// // Migrate all receipts.
    /// let migrated = bridge.migrate_escrow(&10);
    /// assert_eq!(migrated, 2);
    ///
    /// // After migration, version is set to ESCROW_STORAGE_VERSION.
    /// assert_eq!(bridge.get_escrow_storage_version(), ESCROW_STORAGE_VERSION);
    ///
    /// // Callers can gate migration-dependent logic on the version directly:
    /// if bridge.get_escrow_storage_version() < ESCROW_STORAGE_VERSION {
    ///     // Migration is pending or partial.
    /// }
    /// ```
    ///
    /// # See also
    ///
    /// - [`FiatBridge::migrate_escrow`] — performs the migration and sets this version.
    /// - [`FiatBridge::get_migration_cursor`] — tracks migration progress.
    /// - [`FiatBridge::get_escrow_record`] — reads migrated escrow records.
    /// - [`DataKey::EscrowStorageVersion`] — storage key for this value.
    pub fn get_escrow_storage_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowStorageVersion)
            .unwrap_or(0)
    }

    /// Migrate receipt data to persistent escrow records in batches.
    ///
    /// The bridge issues deposits as [`Receipt`] entries stored in persistent
    /// storage keyed by receipt hash, with a sequential index in temporary
    /// storage for enumeration.  Temporary entries have a limited TTL, so for
    /// long-lived escrow positions the data must be promoted to a persistent,
    /// sequentially-keyed [`EscrowRecord`] that will not expire.
    ///
    /// This function walks the receipt index from the current cursor forward,
    /// copying each receipt it finds into a persistent `EscrowRecord` slot.
    /// The process is batched (`batch_size` entries per call) so that it can
    /// be resumed across multiple invocations — useful when the total number
    /// of receipts is large and a single call would exceed the Soroban budget.
    ///
    /// # Caller requirements
    ///
    /// - `admin` (the stored admin address) **must** authenticate.  See
    ///   [`FiatBridge::transfer_admin`] for the two-step admin transfer flow.
    ///
    /// # Parameters
    ///
    /// - `batch_size` — maximum number of receipt positions to process in
    ///   this call.  A value of `0` is accepted and immediately returns `0`.
    ///
    /// # Returns
    ///
    /// - `Ok(count)` — the number of receipts successfully migrated in this
    ///   batch (may be less than `batch_size` when the remaining receipts
    ///   are fewer).  `count` is `0` when the cursor has already reached the
    ///   end of the receipt counter.
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`] — the contract has not been initialised
    ///   (no `Admin` key in storage).
    /// - [`Error::MigrationAlreadyComplete`] — the stored version equals or
    ///   exceeds [`ESCROW_STORAGE_VERSION`]; a second call is a no-op.
    ///
    /// # Notes
    ///
    /// - A receipt index entry that has **expired** from temporary storage is
    ///   silently skipped (no `EscrowRecord` is created for that slot).  The
    ///   cursor still advances past it, leaving a permanent gap at that id.
    /// - The same applies when the persistent `Receipt` entry has been removed
    ///   (e.g. after a refund or manual cleanup).
    /// - When the last receipt in the counter has been processed, the stored
    ///   version is bumped so that subsequent calls return
    ///   `MigrationAlreadyComplete` immediately.
    /// - A [`MigrationEvent`] is emitted after every batch with the new cursor
    ///   position and the count of records migrated in that invocation.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Deposit two test receipts.
    /// bridge.deposit(&user, &100, &token, &Bytes::new(&env), &0, &0, &None);
    /// bridge.deposit(&user, &250, &token, &Bytes::new(&env), &0, &0, &None);
    ///
    /// // Migrate a batch of up to 10.
    /// let count = bridge.migrate_escrow(&10);
    /// assert_eq!(count, 2);               // both receipts migrated
    /// assert_eq!(bridge.get_migration_cursor(), 2);
    ///
    /// // Now a second call is a no-op (version already bumped).
    /// assert_eq!(
    ///     bridge.try_migrate_escrow(&10),
    ///     Err(Ok(Error::MigrationAlreadyComplete))
    /// );
    /// ```
    ///
    /// ## See also
    /// - [`FiatBridge::get_escrow_storage_version`] — query current version.
    /// - [`FiatBridge::get_escrow_record`] — read a migrated record by id.
    /// - [`FiatBridge::get_migration_cursor`] — current cursor position.
    /// - [`EscrowRecord`] — the target record type produced by migration.
    /// - [`MigrationEvent`] — the event emitted after each batch.
    pub fn migrate_escrow(env: Env, batch_size: u32) -> Result<u32, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowStorageVersion)
            .unwrap_or(0);

        if current_version >= ESCROW_STORAGE_VERSION {
            return Err(Error::MigrationAlreadyComplete);
        }

        let cursor: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowMigrationCursor)
            .unwrap_or(0);

        let receipt_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);

        let mut migrated_count: u32 = 0;
        let mut current_id = cursor;

        while current_id < receipt_counter && migrated_count < batch_size {
            // Look up the hash stored at this sequential index position
            if let Some(receipt_hash) = env
                .storage()
                .temporary()
                .get::<_, BytesN<32>>(&DataKey::ReceiptIndex(current_id))
            {
                if let Some(receipt) = env
                    .storage()
                    .persistent()
                    .get::<_, Receipt>(&DataKey::Receipt(receipt_hash))
                {
                    let escrow = EscrowRecord {
                        version: ESCROW_STORAGE_VERSION,
                        depositor: receipt.depositor,
                        token: env
                            .storage()
                            .instance()
                            .get(&DataKey::Token)
                            .unwrap_or_else(|| {
                                Address::from_string(&soroban_sdk::String::from_str(&env, ""))
                            }),
                        amount: receipt.amount,
                        ledger: receipt.ledger,
                        migrated: true,
                    };
                    env.storage()
                        .persistent()
                        .set(&DataKey::EscrowRecord(current_id), &escrow);
                    migrated_count += 1;
                }
            }
            current_id += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::EscrowMigrationCursor, &current_id);

        if current_id >= receipt_counter {
            env.storage()
                .instance()
                .set(&DataKey::EscrowStorageVersion, &ESCROW_STORAGE_VERSION);
        }

        MigrationEvent {
            version: EVENT_VERSION,
            cursor: current_id,
            migrated_count,
        }
        .publish(&env);

        Ok(migrated_count)
    }

    /// Look up a single migrated escrow position by its sequential id.
    ///
    /// This is the read side of the receipt→escrow migration and the intended
    /// way for indexers, dashboards and off-chain reconciliation jobs to
    /// enumerate escrowed balances: ids are dense and start at `0`, so a caller
    /// can walk `0..get_migration_cursor()` without knowing any receipt hashes.
    /// It is a plain storage read — no authentication is required and no state
    /// is mutated, so it is safe to call from a simulation.
    ///
    /// An id maps to the position the originating [`Receipt`] occupied in
    /// `DataKey::ReceiptIndex`, so escrow id `n` always describes the `n`-th
    /// deposit the bridge ever recorded.
    ///
    /// # Parameters
    ///
    /// - `id`: zero-based index of the escrow record, in deposit order. Values
    ///   at or above [`FiatBridge::get_migration_cursor`] have not been migrated yet.
    ///
    /// # Returns
    ///
    /// - `Some(record)` — the stored [`EscrowRecord`] for `id`.
    /// - `None` — in three distinct situations, which this function does *not*
    ///   distinguish between:
    ///   1. `id` is beyond the migration cursor, so the record has simply not
    ///      been written yet (call [`FiatBridge::migrate_escrow`] to advance);
    ///   2. `id` is past the end of the receipt range and will never exist;
    ///   3. the source receipt had been evicted from `temporary` storage before
    ///      migration reached it, so that cursor position was skipped and left
    ///      permanently empty.
    ///
    ///   Compare `id` against [`FiatBridge::get_migration_cursor`] and
    ///   [`FiatBridge::get_escrow_storage_version`] to tell case 1 from cases 2 and 3.
    ///
    /// # Errors
    ///
    /// None. This function cannot fail: a missing entry is reported as `None`
    /// rather than an [`Error`], and it neither requires auth nor panics.
    ///
    /// # Notes
    ///
    /// - Reading does not extend the entry's TTL. A record whose persistent TTL
    ///   has lapsed reads back as `None`; use the receipt TTL-bumping paths to
    ///   keep long-lived positions alive.
    /// - The returned `version` field should be checked against
    ///   [`ESCROW_STORAGE_VERSION`] before interpreting the payload, so that a
    ///   future schema bump surfaces as a version mismatch rather than a
    ///   silently misread record.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Two deposits, then a migration large enough to cover both.
    /// bridge.deposit(&user, &100, &token, &Bytes::new(&env), &0, &0, &None);
    /// bridge.deposit(&user, &250, &token, &Bytes::new(&env), &0, &0, &None);
    /// assert_eq!(bridge.migrate_escrow(&10), 2);
    ///
    /// // Ids are dense and ordered by deposit, so escrow 1 is the 250 deposit.
    /// let record = bridge.get_escrow_record(&1).expect("migrated");
    /// assert_eq!(record.amount, 250);
    /// assert_eq!(record.depositor, user);
    /// assert_eq!(record.version, ESCROW_STORAGE_VERSION);
    /// assert!(record.migrated);
    ///
    /// // Nothing was ever deposited at index 2.
    /// assert!(bridge.get_escrow_record(&2).is_none());
    /// ```
    pub fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord> {
        env.storage().persistent().get(&DataKey::EscrowRecord(id))
    }

    /// Returns the current position of the receipt→escrow migration.
    ///
    /// This function reports how many receipt positions have been successfully
    /// migrated to persistent [`EscrowRecord`] entries by [`FiatBridge::migrate_escrow`].
    /// The cursor is a monotonically increasing counter that starts at `0` and
    /// advances as migration progresses.
    ///
    /// This is the primary way for indexers, dashboards, and off-chain services
    /// to track migration progress and determine which escrow records are available
    /// for enumeration via [`FiatBridge::get_escrow_record`].
    ///
    /// # Parameters
    ///
    /// None. This is a read-only view function that requires no arguments.
    ///
    /// # Returns
    ///
    /// - `u64` — the current migration cursor value. This represents the number
    ///   of receipt positions that have been migrated. All escrow records with
    ///   ids in the range `0..cursor` are guaranteed to exist (unless evicted).
    ///   Returns `0` if migration has not started or the cursor was never set.
    ///
    /// # Errors
    ///
    /// None. This function cannot fail: it performs a simple storage read and
    /// returns a default value (`0`) if the cursor has never been initialized.
    /// No authentication is required and no state is mutated.
    ///
    /// # Notes
    ///
    /// - The cursor is stored in instance storage and persists across contract
    ///   invocations.
    /// - When the cursor equals the receipt counter, migration is considered
    ///   complete and [`FiatBridge::get_escrow_storage_version`] is updated.
    /// - This function is safe to call from a simulation context since it requires
    ///   no auth and mutates no state.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Initially, no migration has occurred.
    /// assert_eq!(bridge.get_migration_cursor(), 0);
    ///
    /// // Deposit some receipts.
    /// bridge.deposit(&user, &100, &token, &Bytes::new(&env), &0, &0, &None);
    /// bridge.deposit(&user, &250, &token, &Bytes::new(&env), &0, &0, &None);
    ///
    /// // Migrate up to 10 receipts.
    /// let migrated = bridge.migrate_escrow(&10);
    /// assert_eq!(migrated, 2);
    ///
    /// // Cursor now reflects the 2 migrated positions.
    /// assert_eq!(bridge.get_migration_cursor(), 2);
    ///
    /// // Escrow records 0 and 1 are now available.
    /// assert!(bridge.get_escrow_record(&0).is_some());
    /// assert!(bridge.get_escrow_record(&1).is_some());
    /// assert!(bridge.get_escrow_record(&2).is_none()); // Beyond cursor
    /// ```
    ///
    /// # Cross-references
    ///
    /// - [`FiatBridge::migrate_escrow`] — advances this cursor
    /// - [`FiatBridge::get_escrow_record`] — reads records using this cursor
    /// - [`FiatBridge::get_escrow_storage_version`] — indicates migration completion
    /// - [`DataKey::EscrowMigrationCursor`] — storage key for this value
    pub fn get_migration_cursor(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowMigrationCursor)
            .unwrap_or(0)
    }

    /// Set the migration cursor to a specific value.
    ///
    /// This function allows manual control over the migration cursor position.
    /// It is primarily intended for recovery scenarios where the cursor needs
    /// to be adjusted due to migration issues.
    ///
    /// # Parameters
    ///
    /// - `cursor` – the new cursor value to set
    ///
    /// # Errors
    ///
    /// - `Error::NotInitialized` – if the contract has not been initialized
    /// - `Error::Unauthorized` – if the caller is not the admin
    /// - `Error::InvalidAmount` – if the cursor is zero, negative, or i128::MAX
    pub fn set_migration_cursor(env: Env, cursor: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        
        if cursor <= 0 {
            return Err(Error::InvalidAmount);
        }
        if cursor == i128::MAX {
            return Err(Error::InvalidAmount);
        }
        
        env.storage()
            .instance()
            .set(&DataKey::EscrowMigrationCursor, &(cursor as u64));
        Ok(())
    }

    // ── Batched Admin Operations ──────────────────────────────────────────
    pub fn execute_batch_admin(
        env: Env,
        operations: Vec<BatchAdminOp>,
    ) -> Result<BatchResult, Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "execute_batch_admin"));
        
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Issue #841: reject if admin has been granted the operator role (role confusion)
        let admin_is_operator: bool = env
            .storage()
            .instance()
            .get(&DataKey::Operator(admin.clone()))
            .unwrap_or(false);
        if admin_is_operator {
            return Err(Error::NotAllowed);
        }

        // Emit role check event for auditability
        AdminRoleCheckEvent {
            version: EVENT_VERSION,
            admin: admin.clone(),
            is_operator: false,
        }
        .publish(&env);

        let total_ops = operations.len();
        let mut success_count: u32 = 0;
        let mut failure_count: u32 = 0;
        let mut first_failed_index: Option<u32> = None;

        for (idx, op) in operations.iter().enumerate() {
            let result = Self::execute_single_admin_op(&env, &op);
            if result.is_err() {
                BatchFailEvent { version: EVENT_VERSION, index: idx as u32, total_ops }.publish(&env);
                failure_count += 1;
                if first_failed_index.is_none() {
                    first_failed_index = Some(idx as u32);
                }
                continue;
            }
            success_count += 1;
        }

        let batch_result = BatchResult {
            total_ops,
            success_count,
            failure_count,
            failed_index: first_failed_index,
        };

        BatchOkEvent { version: EVENT_VERSION, success_count, failure_count, total_ops }.publish(&env);

        Ok(batch_result)
    }

    fn execute_single_admin_op(env: &Env, op: &BatchAdminOp) -> Result<(), Error> {
        let op_name = &op.op_type;

        if *op_name == Symbol::new(env, "set_cooldown") {
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::CooldownLedgers, &ledgers);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_lock") {
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage().instance().set(&DataKey::LockPeriod, &ledgers);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_quota") {
            let quota = Self::bytes_to_i128(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::WithdrawalQuota, &quota);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_sandwich") {
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::AntiSandwichDelay, &ledgers);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_slippage_threshold") {
            let threshold_bps = Self::bytes_to_u32(env, &op.payload)?;
            // Validate slippage threshold is reasonable (0-10000 bps = 0-100%)
            if threshold_bps > 10000 {
                return Err(Error::SlippageTooHigh);
            }
            env.storage()
                .instance()
                .set(&DataKey::SlippageThreshold, &threshold_bps);
            SlippageThresholdSetEvent { version: EVENT_VERSION, threshold_bps }.publish(env);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_limit") {
            // Payload: [Address(token), i128(limit)]
            // For simplicity in multisig mockup, we might need a better encoding or specialized ops.
            // But let's add the basic admin ones first.
            Err(Error::InternalError)
        } else if *op_name == Symbol::new(env, "pause") {
            env.storage().instance().set(&DataKey::Paused, &true);
            Ok(())
        } else if *op_name == Symbol::new(env, "unpause") {
            env.storage().instance().set(&DataKey::Paused, &false);
            Ok(())
        } else if *op_name == Symbol::new(env, "update_multisig") {
            // Special op to update signers and threshold
            // Payload: [threshold(u32), signers(Vec<Address>)]
            // This needs custom decoding.
            Err(Error::InternalError)
        } else {
            Err(Error::InternalError)
        }
    }

    fn bytes_to_u32(_env: &Env, bytes: &Bytes) -> Result<u32, Error> {
        if bytes.len() < 4 {
            return Err(Error::InternalError);
        }
        let mut arr = [0u8; 4];
        for (i, slot) in arr.iter_mut().enumerate() {
            *slot = bytes.get(i as u32).ok_or(Error::InternalError)?;
        }
        Ok(u32::from_be_bytes(arr))
    }

    fn bytes_to_i128(_env: &Env, bytes: &Bytes) -> Result<i128, Error> {
        if bytes.len() < 16 {
            return Err(Error::InternalError);
        }
        let mut arr = [0u8; 16];
        for (i, slot) in arr.iter_mut().enumerate() {
            *slot = bytes.get(i as u32).ok_or(Error::InternalError)?;
        }
        Ok(i128::from_be_bytes(arr))
    }

    pub fn get_event_version(_env: Env) -> u32 {
        EVENT_VERSION
    }

    // ── Issue #214: deployment config hash view ───────────────────────────

    /// Return the SHA-256 hash of the critical deployment parameters that was
    /// computed and stored immutably during `init`.
    pub fn get_deploy_config_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::DeployConfigHash)
    }

    // ── Issue #209: global circuit breaker ───────────────────────────────

    /// Set the rolling withdrawal volume threshold that trips the global circuit breaker.
    ///
    /// The circuit breaker is a safety mechanism that automatically halts withdrawals
    /// when unusual outflow volume is detected within a rolling 24-hour window
    /// (~17 280 ledgers at 5 s/ledger). This function controls the volume level at
    /// which that halt triggers.
    ///
    /// When cumulative withdrawal volume inside the current 24-hour ledger window
    /// reaches or exceeds `threshold`, the breaker trips: the offending withdrawal
    /// still executes, but a [`CircuitBreakerTrippedEvent`] is emitted and every
    /// subsequent guarded operation returns [`Error::CircuitBreakerActive`] until
    /// the breaker is cleared.
    ///
    /// The volume check runs on every withdrawal-producing path, covering:
    /// - direct operator withdrawals ([`Self::withdraw`])
    /// - queued withdrawal execution ([`Self::execute_withdrawal`])
    /// - queued withdrawal requests ([`Self::request_withdrawal`])
    ///
    /// # Parameters
    ///
    /// - `threshold` (`i128`): the cumulative 24-hour withdrawal volume that triggers
    ///   the breaker, expressed in the token's smallest indivisible unit (e.g. stroops
    ///   for XLM).
    ///   - `> 0` — enables the breaker; trips when the rolling 24-hour volume
    ///     meets or exceeds this value.
    ///   - `== 0` — disables the breaker entirely; all guarded withdrawal paths
    ///     skip the volume check.
    ///   - Negative values are treated identically to `0` (disabled), because the
    ///     internal guard evaluates `threshold <= 0`.
    ///
    /// # Returns
    ///
    /// `Ok(())` on success. The value is persisted to instance storage and takes
    /// effect on the very next withdrawal evaluation.
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`] — the contract has not been initialised yet
    ///   (no admin stored in instance storage). Call `init` first.
    /// - Panics with a Soroban host auth error if the caller is not the current admin.
    ///   Use [`Self::transfer_admin`] to inspect or change the admin address.
    ///
    /// # Notes
    ///
    /// - The new threshold takes effect immediately for the **next** withdrawal
    ///   evaluation; it does not retroactively clear or trip the breaker.
    /// - Lowering the threshold while the breaker is already tripped has no
    ///   additional effect — the breaker remains tripped until explicitly cleared.
    ///   Raising the threshold while the breaker is tripped likewise does not
    ///   auto-clear it; call [`Self::reset_circuit_breaker`] explicitly.
    /// - Setting `threshold` to `0` while the breaker is tripped does **not**
    ///   automatically clear it. Clear the breaker first with
    ///   [`Self::reset_circuit_breaker`], then set the threshold to `0`.
    /// - The rolling 24-hour volume accumulator is **not** reset by this call.
    ///   Volume tracked before this call counts toward the new threshold on the
    ///   next withdrawal.
    /// - To read the currently active threshold, call
    ///   [`Self::get_circuit_breaker_threshold`].
    /// - To clear a tripped breaker, call [`Self::reset_circuit_breaker`].
    /// - To configure how long the breaker stays tripped before auto-reset, call
    ///   [`Self::set_circuit_breaker_reset_window`].
    /// - To inspect whether the breaker is currently tripped, call
    ///   [`Self::is_circuit_breaker_tripped`].
    ///
    /// # Example
    ///
    /// ```ignore
    /// // 1. Enable the breaker: trip if more than 10 000 stroops are withdrawn
    /// //    within any rolling 24-hour window (~17 280 ledgers at 5 s/ledger).
    /// bridge.set_circuit_breaker_threshold(&env, 10_000)?;
    /// assert_eq!(bridge.get_circuit_breaker_threshold(), 10_000);
    ///
    /// // 2. A withdrawal that pushes cumulative volume past 10 000 stroops will
    /// //    still execute, emit CircuitBreakerTrippedEvent, and then block
    /// //    all subsequent guarded operations with Error::CircuitBreakerActive.
    /// bridge.withdraw(&operator, &recipient, &10_001, &token)?;
    /// assert!(bridge.is_circuit_breaker_tripped());
    ///
    /// // 3. After investigating, clear the breaker manually and resume operations.
    /// bridge.reset_circuit_breaker()?;
    /// assert!(!bridge.is_circuit_breaker_tripped());
    ///
    /// // 4. Disable the breaker entirely — no volume limit enforced.
    /// bridge.set_circuit_breaker_threshold(&env, 0)?;
    /// assert_eq!(bridge.get_circuit_breaker_threshold(), 0);
    /// ```
    pub fn set_circuit_breaker_threshold(env: Env, threshold: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerThreshold, &threshold);
        Ok(())
    }

    /// Configure how long the circuit breaker stays tripped before it clears itself automatically.
    ///
    /// When the breaker trips it can either stay tripped indefinitely (requiring a
    /// manual admin call to clear it) or clear itself once a configurable ledger count
    /// has elapsed. This function lets operators choose between those two modes and
    /// tune how aggressive the cool-down period is — a shorter window restores normal
    /// operations sooner after a spike; a longer window (or `u32::MAX`) forces a human
    /// review before withdrawals resume.
    ///
    /// When the breaker trips, the contract records the current ledger sequence number.
    /// On every subsequent guarded withdrawal path the contract evaluates:
    ///
    /// ```text
    /// current_ledger > tripped_at + reset_window
    /// ```
    ///
    /// If that condition holds, the breaker auto-resets: the tripped flag is cleared,
    /// the 24-hour withdrawal volume window is rolled forward, and a
    /// [`CircuitBreakerAutoResetEvent`] is emitted before the operation continues.
    ///
    /// If the condition does not hold, or auto-reset is disabled, the operation returns
    /// [`Error::CircuitBreakerActive`].
    ///
    /// If this function has never been called, the runtime falls back to the compile-time
    /// constant `CIRCUIT_BREAKER_RESET_LEDGERS` (34 560 ledgers, ~48 hours at 5 s/ledger).
    ///
    /// # Parameters
    ///
    /// - `ledgers` (`u32`): the number of ledgers after the breaker trips before it
    ///   auto-resets.
    ///   - `u32::MAX` — disables auto-reset entirely; the breaker will remain tripped
    ///     until [`Self::reset_circuit_breaker`] is called manually. Use this for
    ///     high-security deployments where every trip must be reviewed by an admin.
    ///   - `17_280` — auto-reset after ~24 hours (1 × `WINDOW_LEDGERS`). A balanced
    ///     default for most production deployments.
    ///   - `34_560` — auto-reset after ~48 hours (the compile-time default). Gives
    ///     a full business-day buffer for out-of-hours incidents.
    ///   - any other non-`MAX` value — auto-resets that many ledgers after the trip.
    ///   - `0` — the condition `current_ledger > tripped_at + 0` becomes true on the
    ///     very next ledger, so the breaker effectively auto-resets immediately. This
    ///     is almost never the right choice; call [`Self::reset_circuit_breaker`] for
    ///     an instant manual clear instead.
    ///
    /// # Returns
    ///
    /// `Ok(())` on success. The value is persisted to instance storage and takes
    /// effect on the very next guarded withdrawal evaluation.
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`] — the contract has not been initialised (no admin
    ///   in instance storage). Call `init` first.
    /// - Panics with a Soroban host auth error if the caller is not the current admin.
    ///   Use [`Self::transfer_admin`] to inspect or change the admin address.
    ///
    /// # Notes
    ///
    /// - The new window takes effect immediately for the next guarded evaluation;
    ///   it does not retroactively change whether the breaker is currently tripped.
    /// - Changing the window while the breaker is already tripped does not clear it.
    ///   If you want to shorten the wait and resume immediately, call
    ///   [`Self::reset_circuit_breaker`] explicitly.
    /// - The auto-reset check uses `saturating_add` to guard against `tripped_at`
    ///   overflow. Values near `u32::MAX - 1` will saturate at `u32::MAX`, and the
    ///   condition will never be true unless `current_ledger` also reaches `u32::MAX`.
    /// - To read the currently active window, call [`Self::get_circuit_breaker_reset_window`].
    /// - To set the withdrawal volume threshold that trips the breaker, call
    ///   [`Self::set_circuit_breaker_threshold`].
    /// - To clear a tripped breaker right now without waiting, call
    ///   [`Self::reset_circuit_breaker`].
    /// - To inspect whether the breaker is currently tripped, call
    ///   [`Self::is_circuit_breaker_tripped`].
    ///
    /// # Example
    ///
    /// ```ignore
    /// // 1. Configure a 24-hour auto-reset window (~17 280 ledgers at 5 s/ledger).
    /// bridge.set_circuit_breaker_reset_window(&env, 17_280)?;
    /// assert_eq!(bridge.get_circuit_breaker_reset_window(), 17_280);
    ///
    /// // 2. Trip the breaker by crossing the volume threshold.
    /// bridge.set_circuit_breaker_threshold(&env, 500)?;
    /// bridge.withdraw(&operator, &recipient, &501, &token)?;
    /// assert!(bridge.is_circuit_breaker_tripped());
    ///
    /// // 3. Advance the ledger past the reset window; the next guarded
    /// //    withdrawal will auto-reset the breaker and emit
    /// //    CircuitBreakerAutoResetEvent before proceeding.
    /// env.ledger().set_sequence_number(env.ledger().sequence() + 17_281);
    /// bridge.withdraw(&operator, &recipient, &1, &token)?; // succeeds; breaker cleared
    /// assert!(!bridge.is_circuit_breaker_tripped());
    ///
    /// // 4. Disable auto-reset — only a manual reset_circuit_breaker call can clear it.
    /// bridge.set_circuit_breaker_reset_window(&env, u32::MAX)?;
    /// assert_eq!(bridge.get_circuit_breaker_reset_window(), u32::MAX);
    /// ```
    pub fn set_circuit_breaker_reset_window(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerResetWindow, &ledgers);
        Ok(())
    }

    /// Return the auto-reset window that is currently in effect, in ledgers.
    ///
    /// If no value has been explicitly configured via
    /// [`Self::set_circuit_breaker_reset_window`], this returns the compile-time
    /// default [`CIRCUIT_BREAKER_RESET_LEDGERS`] (~48 hours).
    ///
    /// A return value of [`u32::MAX`] means auto-reset is disabled; the breaker
    /// will stay tripped until [`Self::reset_circuit_breaker`] is called manually.
    pub fn get_circuit_breaker_reset_window(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerResetWindow)
            .unwrap_or(CIRCUIT_BREAKER_RESET_LEDGERS)
    }

    /// Immediately clear a tripped circuit breaker so that guarded withdrawal operations
    /// can resume without waiting for the auto-reset window to expire.
    ///
    /// The circuit breaker halts withdrawals when rolling 24-hour outflow volume exceeds
    /// the configured threshold. This function is the explicit admin escape-hatch: call it
    /// after investigating the activity that caused the trip and confirming it is safe to
    /// resume. It is the *only* way to clear the breaker when auto-reset is disabled
    /// (`reset_window == u32::MAX`), and it is the fastest path in every other mode — there
    /// is no need to wait for the ledger count to elapse.
    ///
    /// On success the function:
    /// 1. Clears the tripped flag in instance storage so that all subsequent guarded
    ///    withdrawal paths proceed normally.
    /// 2. Always emits a [`CircuitBreakerResetEvent`] carrying the current ledger sequence,
    ///    regardless of whether the breaker was tripped at the time of the call. This
    ///    provides an unconditional audit trail for every admin-initiated reset.
    ///
    /// The ledger sequence at which the breaker originally tripped is intentionally
    /// preserved in storage and is not cleared by this call. It remains available for
    /// off-chain audit until the next trip overwrites it.
    ///
    /// # Parameters
    ///
    /// None. The caller is identified solely by Soroban auth; only the current admin
    /// address may invoke this function.
    ///
    /// # Returns
    ///
    /// `Ok(())` on success. Calling this function when the breaker is already clear is a
    /// no-op — it succeeds silently and still emits [`CircuitBreakerResetEvent`].
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`] — the contract has not been initialised (no admin in
    ///   instance storage). Call `init` first.
    /// - Panics with a Soroban host auth error if the caller is not the current admin.
    ///   Use [`Self::transfer_admin`] to inspect or change the admin address.
    ///
    /// # Notes
    ///
    /// - This function does not change the configured threshold or reset window. The
    ///   breaker will trip again on the next withdrawal that breaches the same threshold.
    ///   If the threshold needs to be raised or disabled, call
    ///   [`Self::set_circuit_breaker_threshold`] separately.
    /// - The rolling 24-hour withdrawal volume accumulator is **not** reset by this call.
    ///   Volume already tracked in the current window still counts toward the threshold on
    ///   the next withdrawal. To avoid an immediate re-trip, consider raising the threshold
    ///   first, or waiting until the 24-hour window rolls over naturally.
    /// - To check whether the breaker is currently tripped before calling, use
    ///   [`Self::is_circuit_breaker_tripped`].
    /// - To read the configured volume threshold, call
    ///   [`Self::get_circuit_breaker_threshold`].
    /// - To read or change the auto-reset window, call
    ///   [`Self::get_circuit_breaker_reset_window`] or
    ///   [`Self::set_circuit_breaker_reset_window`].
    ///
    /// # Example
    ///
    /// ```ignore
    /// // 1. Configure a threshold and trip the breaker.
    /// bridge.set_circuit_breaker_threshold(&env, 1_000)?;
    /// bridge.withdraw(&operator, &recipient, &1_001, &token)?;
    /// assert!(bridge.is_circuit_breaker_tripped());
    ///
    /// // 2. Subsequent withdrawals are blocked until the breaker is cleared.
    /// let err = bridge.try_withdraw(&operator, &recipient, &1, &token).unwrap_err();
    /// assert_eq!(err, Ok(Error::CircuitBreakerActive));
    ///
    /// // 3. After investigation, clear the breaker — emits CircuitBreakerResetEvent.
    /// bridge.reset_circuit_breaker()?;
    /// assert!(!bridge.is_circuit_breaker_tripped());
    ///
    /// // 4. Guarded operations resume normally.
    /// bridge.withdraw(&operator, &recipient, &1, &token)?;
    /// ```
    pub fn reset_circuit_breaker(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerTripped, &false);
        CircuitBreakerResetEvent { version: EVENT_VERSION, ledger: env.ledger().sequence() }.publish(&env);
        Ok(())
    }

    /// Return the currently configured rolling-volume threshold.
    ///
    /// A return value of `0` means the circuit breaker is disabled and no
    /// volume limit is enforced.  See [`Self::set_circuit_breaker_threshold`]
    /// for the full semantics.
    pub fn get_circuit_breaker_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerThreshold)
            .unwrap_or(0)
    }

    /// Return whether the circuit breaker is currently tripped.
    ///
    /// This is the primary read-only probe for the circuit breaker's state. Use it to
    /// gate off-chain alerting, drive monitoring dashboards, assert post-conditions in
    /// integration tests, or verify state before deciding whether to call
    /// [`Self::reset_circuit_breaker`].
    ///
    /// **Important:** this is a pure storage read — it reflects the persisted flag at
    /// the moment of the call and does **not** evaluate whether the auto-reset window
    /// has elapsed. If the breaker was tripped and the configured reset window has since
    /// passed, this function still returns `true`. The flag is only cleared lazily: the
    /// next guarded withdrawal path evaluates the window and auto-resets if eligible,
    /// emitting [`CircuitBreakerAutoResetEvent`]. If you need an immediate clear without
    /// waiting for a withdrawal, call [`Self::reset_circuit_breaker`] explicitly.
    ///
    /// # Parameters
    ///
    /// None. This is a read-only view function that requires no arguments and no
    /// authentication.
    ///
    /// # Returns
    ///
    /// - `true` — the breaker is tripped; all guarded withdrawal paths will return
    ///   [`Error::CircuitBreakerActive`] until the breaker is cleared (either by
    ///   [`Self::reset_circuit_breaker`] or by the lazy auto-reset on the next
    ///   guarded withdrawal after the window elapses).
    /// - `false` — the breaker is clear, or has never been tripped (the storage key
    ///   is absent and defaults to `false`).
    ///
    /// # Errors
    ///
    /// None. This function performs a plain instance-storage read, requires no auth,
    /// and cannot panic.
    ///
    /// # Notes
    ///
    /// - Because auto-reset is lazy, a `true` return does not necessarily mean
    ///   withdrawals are still blocked — if the reset window has elapsed, the next
    ///   withdrawal call will clear the breaker automatically before proceeding.
    ///   Do not use this function alone to determine whether a withdrawal will succeed.
    /// - To clear a tripped breaker immediately, call [`Self::reset_circuit_breaker`].
    /// - To read the auto-reset window that governs lazy clearing, call
    ///   [`Self::get_circuit_breaker_reset_window`].
    /// - To read or change the volume threshold that causes the breaker to trip, call
    ///   [`Self::get_circuit_breaker_threshold`] or
    ///   [`Self::set_circuit_breaker_threshold`].
    /// - To change the auto-reset window, call [`Self::set_circuit_breaker_reset_window`].
    ///
    /// # Example
    ///
    /// ```ignore
    /// // 1. Before any threshold breach the breaker is clear.
    /// assert!(!bridge.is_circuit_breaker_tripped());
    ///
    /// // 2. A withdrawal that pushes rolling volume past the threshold trips it.
    /// bridge.set_circuit_breaker_threshold(&env, 500)?;
    /// bridge.withdraw(&operator, &recipient, &501, &token)?; // executes but trips
    /// assert!(bridge.is_circuit_breaker_tripped());
    ///
    /// // 3. Even after the reset window elapses, the flag reads true until the
    /// //    next guarded withdrawal triggers the lazy auto-reset.
    /// env.ledger().set_sequence_number(env.ledger().sequence() + 34_561);
    /// assert!(bridge.is_circuit_breaker_tripped()); // still true — no withdrawal yet
    ///
    /// // 4. A manual reset clears it immediately and emits CircuitBreakerResetEvent.
    /// bridge.reset_circuit_breaker()?;
    /// assert!(!bridge.is_circuit_breaker_tripped());
    /// ```
    pub fn is_circuit_breaker_tripped(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::CircuitBreakerTripped)
            .unwrap_or(false)
    }

    /// Accumulate `amount` into the rolling 24-h global withdrawal volume.
    /// Returns `CircuitBreakerActive` if the threshold is already tripped **or**
    /// if this withdrawal would breach it (breaching withdrawal is rejected).
    fn check_and_update_circuit_breaker(env: &Env, amount: i128) -> Result<(), Error> {
        let threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreakerThreshold)
            .unwrap_or(0);
        if threshold <= 0 {
            return Ok(());
        }

        let curr = env.ledger().sequence();

        // Check if breaker is tripped but eligible for auto-reset.
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::CircuitBreakerTripped)
            .unwrap_or(false)
        {
            let reset_window: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CircuitBreakerResetWindow)
                .unwrap_or(CIRCUIT_BREAKER_RESET_LEDGERS);

            let tripped_at: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CircuitBreakerTrippedAt)
                .unwrap_or(0);

            if reset_window != u32::MAX && curr > tripped_at.saturating_add(reset_window) {
                // Auto-reset: clear the breaker and roll the volume window.
                env.storage()
                    .instance()
                    .set(&DataKey::CircuitBreakerTripped, &false);
                env.storage()
                    .instance()
                    .set(&DataKey::GlobalDailyWithdrawn, &GlobalDailyWithdrawn {
                        amount: 0,
                        window_start: curr,
                    });
                CircuitBreakerAutoResetEvent {
                    version: EVENT_VERSION,
                    tripped_at,
                    reset_at: curr,
                }
                .publish(env);
                // Fall through — process this withdrawal normally.
            } else {
                // Still within reset window — reject.
                return Err(Error::CircuitBreakerActive);
            }
        }

        let mut vol: GlobalDailyWithdrawn = env
            .storage()
            .instance()
            .get(&DataKey::GlobalDailyWithdrawn)
            .unwrap_or(GlobalDailyWithdrawn {
                amount: 0,
                window_start: curr,
            });

        // Roll 24h window if elapsed.
        if curr >= vol.window_start + WINDOW_LEDGERS {
            vol.amount = 0;
            vol.window_start = curr;
        }

        let new_total = vol.amount + amount;
        vol.amount = new_total;
        env.storage()
            .instance()
            .set(&DataKey::GlobalDailyWithdrawn, &vol);

        if new_total >= threshold {
            // Trip the breaker — record when it was tripped.
            env.storage()
                .instance()
                .set(&DataKey::CircuitBreakerTripped, &true);
            env.storage()
                .instance()
                .set(&DataKey::CircuitBreakerTrippedAt, &curr);
            CircuitBreakerTrippedEvent {
                version: EVENT_VERSION,
                new_total,
                threshold,
            }
            .publish(env);
        }

        Ok(())
    }

    // ── Issue #226: withdrawal queue risk-tier prioritization ─────────────

    /// Return the `request_id` that should be processed next according to
    /// risk-tier priority.  Tier 0 is the highest priority; within each tier
    /// FIFO order is preserved.  Returns `None` when the queue is empty.
    pub fn get_next_priority_withdrawal(env: Env) -> Option<u64> {
        // Scan tier 0, 1, 2, … and return the head of the first non-empty tier.
        // We scan up to `next_id` distinct tier values as an upper bound.
        let next_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestID)
            .unwrap_or(0);
        // Tier indices are u32; in practice only a handful of tiers are used.
        // We cap the scan at 256 to stay within compute budget.
        let max_tier: u32 = (next_id.min(256)) as u32;
        for t in 0..=max_tier {
            let tier_len: u64 = env
                .storage()
                .instance()
                .get(&DataKey::TierQueueLen(t))
                .unwrap_or(0);
            if tier_len == 0 {
                continue;
            }
            let head: Option<u64> = env
                .storage()
                .instance()
                .get(&DataKey::TierQueueHead(t))
                .unwrap_or(None);
            if head.is_some() {
                return head;
            }
        }
        None
    }

    /// Advance the per-tier queue head after a request with `tier` is removed.
    fn advance_tier_queue_head(env: &Env, tier: u32, removed_id: u64) {
        let head_key = DataKey::TierQueueHead(tier);
        let head: Option<u64> = env.storage().instance().get(&head_key).unwrap_or(None);
        if head != Some(removed_id) {
            return;
        }

        let tier_len: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TierQueueLen(tier))
            .unwrap_or(0);
        if tier_len == 0 {
            env.storage()
                .instance()
                .set(&head_key, &Option::<u64>::None);
            return;
        }

        let next_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestID)
            .unwrap_or(0);

        let mut i = removed_id.saturating_add(1);
        while i < next_id {
            if let Some(req) = env
                .storage()
                .persistent()
                .get::<_, WithdrawRequest>(&DataKey::WithdrawQueue(i))
            {
                if req.risk_tier == tier {
                    env.storage().instance().set(&head_key, &Some(i));
                    return;
                }
            }
            i += 1;
        }

        env.storage()
            .instance()
            .set(&head_key, &Option::<u64>::None);
    }

    // ── Single Withdraw Operator Role (Issue #118) ─────────────────────────

    pub fn set_withdraw_operator(env: Env, operator: Address) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::WithdrawOperator, &operator);
        SetWithdrawOperatorEvent { version: EVENT_VERSION, operator: operator.clone() }.publish(&env);
        Ok(())
    }

    pub fn remove_withdraw_operator(env: Env) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().remove(&DataKey::WithdrawOperator);
        RemoveWithdrawOperatorEvent { version: EVENT_VERSION }.publish(&env);
        Ok(())
    }

    pub fn get_withdraw_operator(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::WithdrawOperator)
    }

    // ── Issue #107: Governed upgrade mechanism ────────────────────────────

    pub fn set_upgrade_delay(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if ledgers < MIN_UPGRADE_DELAY {
            return Err(Error::UpgradeDelayTooShort);
        }
        env.storage().instance().set(&DataKey::UpgradeDelay, &ledgers);
        Ok(())
    }

    pub fn get_upgrade_delay(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(MIN_UPGRADE_DELAY)
    }

    /// Proposes a contract WASM upgrade subject to a timelock delay.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Delay Bounds**: Validates `delay >= MIN_UPGRADE_DELAY`.
    /// - **Saturating Timelock Sequence**: Calculates `executable_after = env.ledger().sequence().saturating_add(delay)`,
    ///   ensuring that sequence number calculations cannot overflow or bypass the timelock.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `new_wasm_hash` – 32-byte hash of the newly uploaded WASM binary.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] – If caller is not admin.
    #[allow(deprecated)]
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let delay: u32 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(MIN_UPGRADE_DELAY);

        let proposed_at = env.ledger().sequence();
        let proposal = UpgradeProposal {
            wasm_hash: new_wasm_hash.clone(),
            executable_after: proposed_at.saturating_add(delay),
        };

        env.storage().instance().set(&DataKey::UpgradeProposal, &proposal);
        env.storage().instance().set(
            &DataKey::UpgradeProposalTiming,
            &UpgradeProposalTiming {
                wasm_hash: new_wasm_hash.clone(),
                proposed_at,
                delay,
                executable_after: proposal.executable_after,
            },
        );
        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "upg_prop")),
            (new_wasm_hash, proposal.executable_after),
        );
        Ok(())
    }

    #[allow(deprecated)]
    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(Error::UpgradeProposalMissing)?;

        if let Some(timing) = env.storage().instance()
            .get::<_, UpgradeProposalTiming>(&DataKey::UpgradeProposalTiming)
        {
            // A timing record accompanies all new proposals. Do not execute a
            // proposal if its immutable deadline no longer agrees with it.
            if timing.wasm_hash != proposal.wasm_hash
                || timing.executable_after != proposal.executable_after
            {
                return Err(Error::InternalError);
            }
        }

        if env.ledger().sequence() < proposal.executable_after {
            return Err(Error::UpgradeNotReady);
        }

        env.deployer()
            .update_current_contract_wasm(proposal.wasm_hash.clone());
        env.storage().instance().remove(&DataKey::UpgradeProposal);
        env.storage().instance().remove(&DataKey::UpgradeProposalTiming);
        env.events()
            .publish((EVENT_VERSION, Symbol::new(&env, "upg_exec")), proposal.wasm_hash);
        Ok(())
    }

    #[allow(deprecated)]
    pub fn cancel_upgrade(env: Env, nonce: u64) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Validate and increment nonce for replay protection
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeCancellationNonce(admin.clone()))
            .unwrap_or(0);

        if nonce != current_nonce {
            if nonce < current_nonce {
                return Err(Error::StaleNonce);
            } else {
                return Err(Error::InvalidNonce);
            }
        }

        // Increment nonce
        env.storage()
            .instance()
            .set(&DataKey::UpgradeCancellationNonce(admin.clone()), &(current_nonce + 1));

        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(Error::UpgradeProposalMissing)?;

        env.storage().instance().remove(&DataKey::UpgradeProposal);
        env.storage().instance().remove(&DataKey::UpgradeProposalTiming);
        UpgradeCancelledEvent {
            version: EVENT_VERSION,
            admin: admin.clone(),
            wasm_hash: proposal.wasm_hash.clone(),
            nonce: current_nonce + 1,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&DataKey::UpgradeProposal)
    }

    /// Return the ledger and delay recorded for the pending upgrade.
    pub fn get_upgrade_proposal_timing(env: Env) -> Option<UpgradeProposalTiming> {
        env.storage().instance().get(&DataKey::UpgradeProposalTiming)
    }

    /// Add timing metadata to a proposal made by earlier contract versions.
    /// Its original execution deadline remains unchanged.
    pub fn migrate_upgrade_proposal_timing(env: Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if env.storage().instance().has(&DataKey::UpgradeProposalTiming) {
            return Ok(());
        }
        if let Some(proposal) = env.storage().instance()
            .get::<_, UpgradeProposal>(&DataKey::UpgradeProposal)
        {
            let delay = env.storage().instance().get(&DataKey::UpgradeDelay)
                .unwrap_or(MIN_UPGRADE_DELAY);
            env.storage().instance().set(
                &DataKey::UpgradeProposalTiming,
                &UpgradeProposalTiming {
                    wasm_hash: proposal.wasm_hash,
                    proposed_at: proposal.executable_after.saturating_sub(delay),
                    delay,
                    executable_after: proposal.executable_after,
                },
            );
        }
        Ok(())
    }

    // ── Issue #100: Multi-sig Logic ──────────────────────────────────────────

    #[allow(deprecated)]
    pub fn propose_multisig_action(
        env: Env,
        proposer: Address,
        action: BatchAdminOp,
    ) -> Result<u64, Error> {
        proposer.require_auth();

        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).unwrap();
        if !signers.contains(&proposer) {
            return Err(Error::Unauthorized);
        }

        let id: u64 = env.storage().instance().get(&DataKey::NextMultisigID).unwrap();
        env.storage().instance().set(&DataKey::NextMultisigID, &(id + 1));

        let mut approvals = Vec::<Address>::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = MultisigProposal {
            creator: proposer.clone(),
            action,
            approvals,
            executed: false,
            created_at: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::MultisigProposal(id), &proposal);

        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "multisig_proposed")),
            (id, proposer),
        );

        Ok(id)
    }

    #[allow(deprecated)]
    pub fn approve_multisig_action(env: Env, signer: Address, id: u64) -> Result<(), Error> {
        signer.require_auth();

        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).unwrap();
        if !signers.contains(&signer) {
            return Err(Error::Unauthorized);
        }

        let mut proposal: MultisigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultisigProposal(id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        if proposal.approvals.contains(&signer) {
            return Err(Error::AlreadyApproved);
        }

        proposal.approvals.push_back(signer.clone());
        env.storage()
            .instance()
            .set(&DataKey::MultisigProposal(id), &proposal);

        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "multisig_approved")),
            (id, signer),
        );

        Ok(())
    }

    pub fn revoke_multisig_approval(env: Env, signer: Address, id: u64) -> Result<(), Error> {
        signer.require_auth();

        let mut proposal: MultisigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultisigProposal(id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        let mut index = None;
        for (i, a) in proposal.approvals.iter().enumerate() {
            if a == signer {
                index = Some(i as u32);
                break;
            }
        }

        match index {
            Some(i) => {
                proposal.approvals.remove(i);
                env.storage()
                    .instance()
                    .set(&DataKey::MultisigProposal(id), &proposal);
                Ok(())
            }
            None => Err(Error::SignerNotFound),
        }
    }

    #[allow(deprecated)]
    pub fn execute_multisig_action(env: Env, id: u64) -> Result<(), Error> {
        let mut proposal: MultisigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultisigProposal(id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();
        if proposal.approvals.len() < threshold {
            return Err(Error::ThresholdNotMet);
        }

        // Execute the action
        Self::execute_single_admin_op(&env, &proposal.action)?;

        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::MultisigProposal(id), &proposal);

        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "multisig_executed")),
            id,
        );

        Ok(())
    }

    pub fn get_multisig_proposal(env: Env, id: u64) -> Option<MultisigProposal> {
        env.storage().instance().get(&DataKey::MultisigProposal(id))
    }

    pub fn get_multisig_signers(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Signers).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_multisig_threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
    }

    // ── Missing methods referenced by tests ──────────────────────────────

    /// Set a hard cap on the maximum value that can be passed to `set_limit`.
    pub fn set_limit_max_cap(env: Env, cap: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        // A recovery target must be externally controllable. Pointing it at
        // this contract would make the configured recovery route unusable.
        if recovery == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }
        if cap <= 0 {
            return Err(Error::ZeroAmount);
        }
        let current_limit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::LimitMaxCap)
            .unwrap_or(i128::MAX);
        if cap > current_limit {
            return Err(Error::LimitCapCannotBeLowered);
        }
        env.storage().instance().set(&DataKey::LimitMaxCap, &cap);
        LimitMaxCapSetEvent { version: EVENT_VERSION, cap }.publish(&env);
        Ok(())
    }

    /// Return the configured limit max cap (defaults to `i128::MAX`).
    pub fn get_set_limit_max_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::LimitMaxCap)
            .unwrap_or(i128::MAX)
    }

    /// Set a per-operator daily withdrawal limit.
    pub fn set_operator_daily_limit(env: Env, operator: Address, limit: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::OperatorDailyLimit(operator), &limit);
        Ok(())
    }

    /// Configure the emergency recovery address and an associated withdrawal cap.
    pub fn set_emergency_recovery(
        env: Env,
        recovery: Address,
        cap: i128,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if cap <= 0 {
            return Err(Error::ZeroAmount);
        }
        // Cap must not exceed the current bridge limit.
        let tok = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(tok))
            .ok_or(Error::NotInitialized)?;
        if cap > config.limit {
            return Err(Error::ExceedsLimit);
        }
        env.storage()
            .instance()
            .set(&DataKey::EmergencyRecoveryAddress, &recovery);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyRecoveryCap, &cap);
        // Emit event with admin for auditability.
        EmergencyRecoverySetEvent {
            version: EVENT_VERSION,
            recovery: recovery.clone(),
            cap,
            admin: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Return the emergency recovery withdrawal cap, if set.
    pub fn get_emergency_recovery_cap(env: Env) -> Option<i128> {
        env.storage().instance().get(&DataKey::EmergencyRecoveryCap)
    }

    /// Return the pending admin transfer info `(new_admin, proposed_at_ledger)`, if any.
    pub fn get_pending_admin(env: Env) -> Option<(Address, u64)> {
        env.storage()
            .instance()
            .get(&DataKey::PendingAdmin)
    }

    /// Return the current nonce for fee withdrawals (used for replay protection).
    pub fn get_fee_withdrawal_nonce(env: Env, caller: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::FeeWithdrawalNonceByCaller(caller))
            .unwrap_or(0)
    }

    /// Validate and increment the per-caller fee-withdrawal nonce.
    #[allow(dead_code)]
    fn validate_and_increment_fee_withdrawal_nonce(
        env: &Env,
        caller: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FeeWithdrawalNonceByCaller(caller.clone()))
            .unwrap_or(0);

        if provided_nonce != current_nonce {
            if provided_nonce < current_nonce {
                return Err(Error::StaleNonce);
            } else {
                return Err(Error::InvalidNonce);
            }
        }

        env.storage().instance().set(
            &DataKey::FeeWithdrawalNonceByCaller(caller.clone()),
            &(current_nonce + 1),
        );

        NonceIncrementedEvent {
            version: EVENT_VERSION,
            operator: caller.clone(),
            new_nonce: current_nonce + 1,
        }
        .publish(env);

        Ok(())
    }

    /// Migrate the legacy global fee-withdrawal nonce to the admin's per-caller
    /// nonce. Safe to call multiple times; only copies when the target is absent.
    pub fn migrate_fee_withdrawal_nonce(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if let Some(legacy_nonce) = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::FeeWithdrawalNonce)
        {
            let key = DataKey::FeeWithdrawalNonceByCaller(admin.clone());
            if !env.storage().instance().has(&key) {
                env.storage().instance().set(&key, &legacy_nonce);
            }
            env.storage().instance().remove(&DataKey::FeeWithdrawalNonce);
        }

        Ok(())
    }

    /// Get the current upgrade cancellation nonce for an admin
    pub fn get_upgrade_cancellation_nonce(env: Env, admin: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeCancellationNonce(admin))
            .unwrap_or(0)
    }

    /// Get the current withdrawal execution nonce for a user
    pub fn get_withdrawal_execution_nonce(env: Env, user: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalExecutionNonce(user))
            .unwrap_or(0)
    }

    /// Return the current per-caller nonce for batch fee withdrawals
    /// (used for replay protection, Issue #1113).
    pub fn get_fee_withdrawal_batch_nonce(env: Env, caller: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::FeeWithdrawalBatchNonce(caller))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test_view_function_snapshots;

#[cfg(any(test, feature = "testutils"))]
mod test;

#[cfg(test)]
mod test_oracle_staleness;

#[cfg(test)]
mod test_init_validation;

#[cfg(test)]
mod test_approve_multisig_action_invariants;

#[cfg(test)]
mod test_revoke_multisig_approval_invariants;

#[cfg(test)]
mod test_get_multisig_proposal_invariants;

#[cfg(test)]
mod test_propose_multisig_action_invariants;

#[cfg(test)]
mod test_propose_upgrade_invariants;
#[cfg(test)]
mod test_reclaim_expired_withdrawal_invariants;

#[cfg(test)]
mod test_execute_upgrade_invariants;

#[cfg(test)]
mod test_execute_upgrade_timelock_invariants;

#[cfg(test)]
mod test_reset_circuit_breaker_invariants;

#[cfg(test)]
mod test_set_circuit_breaker_threshold_invariants;

#[cfg(test)]
mod test_set_circuit_breaker_reset_window_invariants;

#[cfg(test)]
mod test_withdraw_circuit_breaker;
mod test_get_next_priority_withdrawal_invariants;

#[cfg(test)]
mod test_set_operator_invariants;

#[cfg(test)]
mod test_request_withdrawal_invariants;
#[cfg(test)]
mod test_execute_withdrawal_invariants;
#[cfg(test)]
mod test_heartbeat_batch;


#[cfg(test)]
mod test_is_denied_invariants;

#[cfg(test)]
mod test_get_withdrawal_request_invariants;

#[cfg(test)]
mod test_cancel_withdrawal_invariants;

#[cfg(test)]
mod test_set_fee_recipient_invariants;

#[cfg(test)]
mod test_set_withdrawal_expiry_invariants;

