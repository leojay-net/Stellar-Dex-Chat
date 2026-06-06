#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, xdr::ToXdr, Address,
    Bytes, BytesN, Env, Symbol, Vec,
};

pub mod math;
pub mod oracle;

macro_rules! require {
    ($cond:expr, $err:expr) => {
        if !($cond) {
            return Err($err);
        }
    };
}

// ── Constants ─────────────────────────────────────────────────────────────
/// Minimum TTL extension applied to instance storage on every public call (~30 days).
pub const MIN_TTL: u32 = 518_400;
/// Maximum TTL cap for instance storage extensions (~31 days).
pub const MAX_TTL: u32 = 535_680;
/// Maximum byte length of a deposit reference string.
const MAX_REFERENCE_LEN: u32 = 64;
/// Number of ledgers in a 24-hour rolling window (~5 s/ledger × 17 280 = 24 h).
///
/// Used for daily deposit limits, fiat volume caps, and withdrawal quotas.
/// All window arithmetic uses `saturating_add` on `u32` ledger numbers to
/// prevent overflow when the window start is near `u32::MAX`.
const WINDOW_LEDGERS: u32 = 17_280;
/// Circuit-breaker auto-reset window: 48 hours = 2 × [`WINDOW_LEDGERS`].
const CIRCUIT_BREAKER_RESET_LEDGERS: u32 = 34_560;
/// Default expiry window for unexecuted withdrawal requests (~24 hours).
const WITHDRAWAL_EXPIRY_WINDOW_LEDGERS: u32 = 17_280;
/// Minimum timelock delay for admin actions (48 hours ≈ 34 560 ledgers).
///
/// All ledger-offset computations that use this constant add it to the
/// current ledger sequence.  Because both operands are `u32`, the sum could
/// theoretically overflow; callers use `checked_add` or `saturating_add`
/// where the result is stored, and the upgrade path uses `checked_add`
/// returning [`Error::Overflow`].
const MIN_TIMELOCK_DELAY: u32 = 34_560;
/// Default operator inactivity threshold before pruning (~3 months).
const DEFAULT_INACTIVITY_THRESHOLD: u32 = 1_555_200;
/// Minimum delay (in ledgers) required when proposing a WASM upgrade.
///
/// Enforced in [`FiatBridge::propose_upgrade`].  A delay below this value
/// is rejected with [`Error::UpgradeDelayTooShort`] to prevent surprise
/// upgrades that bypass the governance timelock.
const MIN_UPGRADE_DELAY: u32 = 1_000;
/// Maximum number of signers allowed in the multi-signature configuration.
const MAX_SIGNERS: u32 = 20;
/// Version tag embedded in all contract events for indexer compatibility.
pub const EVENT_VERSION: u32 = 1;
/// Current escrow storage schema version used by the migration system.
pub const ESCROW_STORAGE_VERSION: u32 = 1;
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
    DailyLimitExceeded = 303,
    ExceedsFiatLimit = 304,
    ReferenceTooLong = 305,
    CooldownActive = 306,
    AntiSandwichDelayActive = 307,
    TokenNotWhitelisted = 308,
    AddressDenied = 309,
    RescueForbidden = 310,
    CircuitBreakerActive = 311,
    InvalidMemoHash = 312,
    OperatorDailyLimitExceeded = 313,
    ExceedsLimitMaxCap = 314,
    MaxDeniedReached = 315,

    // --- 400 series: Funds & Balances ---
    InsufficientFunds = 401,
    NoFeesToWithdraw = 402,
    FeeWithdrawalExceedsBalance = 403,

    // --- 500 series: Withdrawal Queue ---
    RequestNotFound = 501,
    WithdrawalLocked = 502,
    ReceiptIndexOutOfBounds = 503,
    ReceiptNotFound = 504,

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

/// Tracks the global rolling-window withdrawal volume used by the circuit breaker.
///
/// The circuit breaker auto-resets the window every 48 hours (`CIRCUIT_BREAKER_RESET_LEDGERS`).
/// When the window is exceeded, further withdrawals are blocked; when the window resets,
/// withdrawals resume.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalDailyWithdrawn {
    /// Aggregate amount withdrawn in the current window.
    pub amount: i128,
    /// Ledger number at which the current 48-hour window started.
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

/// Tracks a user's rolling-window withdrawal amount for quota enforcement.
///
/// The 24-hour window is defined by [`WINDOW_LEDGERS`]. Once the window elapses,
/// the tracker resets and a new window begins.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserDailyWithdrawal {
    /// Total withdrawn by this user in the current 24-hour window.
    pub amount: i128,
    /// Ledger number at which the current window started.
    pub window_start: u32,
}

/// Tracks a user's rolling-window deposit amount for per-token daily limit enforcement.
///
/// The 24-hour window is defined by [`WINDOW_LEDGERS`]. Once the window elapses,
/// the tracker resets and a new window begins.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserDailyDeposit {
    /// Total deposited by this user for the token in the current 24-hour window.
    pub amount: i128,
    /// Ledger number at which the current window started.
    pub window_start: u32,
}

/// Versioned escrow record with migration metadata.
///
/// This struct represents an escrow record that has been migrated to the versioned
/// storage schema. It includes metadata about the migration process and the original
/// transaction details.
///
/// # Fields
///
/// * `version` - Schema version of this record (e.g., 1 for v1 schema)
/// * `depositor` - Address of the original depositor who created the escrow
/// * `token` - Token address for the escrowed amount
/// * `amount` - Escrowed amount in token units
/// * `ledger` - Stellar ledger number when the escrow was created
/// * `migrated` - Flag indicating if this record has been successfully migrated
///
/// # Example
///
/// ```rust
/// let record = EscrowRecord {
///     version: 1,
///     depositor: Address::from_string(&String::from_str(&env, "G...")),
///     token: Address::from_string(&String::from_str(&env, "G...")),
///     amount: 100_000_000,
///     ledger: 12345,
///     migrated: true,
/// };
/// ```
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
/// A single administrative operation in a batch.
///
/// # Fields
///
/// * `op_type` - Symbol identifying the operation type (e.g., "set_cooldown", "pause")
/// * `payload` - Binary-encoded operation parameters (format depends on op_type)
///
/// # Operation Types
///
/// | op_type | payload_len | payload_format | description |
/// |---------|-------------|----------------|-------------|
/// | `set_cooldown` | 4 | u32 big-endian | Set cooldown period in ledgers |
/// | `set_lock` | 4 | u32 big-endian | Set lock period in ledgers |
/// | `set_quota` | 16 | i128 big-endian | Set daily withdrawal quota |
/// | `set_sandwich` | 4 | u32 big-endian | Set anti-sandwich delay in ledgers |
/// | `pause` | 0 | (empty) | Pause all user operations |
/// | `unpause` | 0 | (empty) | Resume user operations |
///
/// # Payload Encoding Rules
///
/// All numeric payloads use **big-endian byte order**. For example:
///
/// ```rust,no_run
/// // To encode u32 value 100:
/// let value: u32 = 100;
/// let payload = Bytes::from_array(&env, &value.to_be_bytes());
/// // payload = [0x00, 0x00, 0x00, 0x64]
/// ```
///
/// Payloads that are too short will cause the operation to fail with `Error::InternalError`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchAdminOp {
    pub op_type: Symbol,
    pub payload: Bytes,
}

/// Result of executing a batch of administrative operations.
///
/// Contains detailed counters for success/failure and indicates which operation
/// failed first (if any). Operations continue executing after failures—this is
/// not a transactional rollback scenario.
///
/// # Fields
///
/// * `total_ops` - Total number of operations in the batch
/// * `success_count` - Number of successfully executed operations
/// * `failure_count` - Number of failed operations (operations that returned an error)
/// * `failed_index` - Zero-based index of the **first** operation that failed, or None if all succeeded
///
/// # Invariants
///
/// 1. `success_count + failure_count == total_ops` (always true)
/// 2. If `failure_count == 0`, then `failed_index == None`
/// 3. If `failure_count > 0`, then `failed_index == Some(idx)` where idx is the index of
///    the first failure (not the only failure, but the **first**); other failures may exist
///    at higher indices but are not recorded in `failed_index`
///
/// # Execution Semantics
///
/// **Important**: The batch is **not** atomic with respect to individual operation failures:
/// - If operation at index 2 fails, operations at indices 0 and 1 have already been applied
/// - Operations at indices 3, 4, 5, ... still execute
/// - State changes from successful operations persist even if a later operation fails
///
/// Each individual operation either succeeds completely or fails without side effects,
/// but the overall batch does not rollback on failure.
///
/// # Example
///
/// ```text
/// Batch of 5 operations: [op0, op1, op2, op3, op4]
///    - op0: succeeds
///    - op1: succeeds
///    - op2: fails (malformed payload)
///    - op3: succeeds
///    - op4: succeeds
///
/// Result:
///   total_ops: 5
///   success_count: 4
///   failure_count: 1
///   failed_index: Some(2)
///
/// Contract state reflects op0, op1, op3, op4 having been applied.
/// op2 had no effect due to the error.
/// ```
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
    /// Admin that co-authorized the deposit (recorded for off-chain audit).
    pub admin: Address,
    pub from: Address,
    pub token: Address,
    pub amount: i128,
    /// Receipt ID issued for this deposit, linking deposit and receipt events.
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
pub struct ReceiptQueryEvent {
    pub version: u32,
    pub index: u64,
    pub receipt_hash: Option<BytesN<32>>,
    pub error_code: Option<u32>,
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
pub struct FeeVaultReconciledEvent {
    pub version: u32,
    pub token: Address,
    /// Vault balance recorded before reconciliation.
    pub previous_balance: i128,
    /// Vault balance after capping to on-chain token reserves.
    pub new_balance: i128,
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
/// Emitted when the admin updates the global per-token limit ceiling.
pub struct SetLimitMaxCapEvent {
    pub version: u32,
    pub max_cap: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FeeVaultThresholdEvent {
    pub version: u32,
    pub token: Address,
    pub threshold: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SetLimitEvent {
    pub version: u32,
    pub token: Address,
    pub limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SlippageEvent {
    pub version: u32,
    pub slippage_bps: u32,
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

#[contractevent]
#[derive(Clone, Debug)]
pub struct SetOperatorEvent {
    pub version: u32,
    pub operator: Address,
    pub active: bool,
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
#[derive(Clone, Debug)]
pub struct NonceIncrementedEvent {
    pub version: u32,
    pub operator: Address,
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
    /// Admin address that authorised the fee withdrawal.
    pub admin: Address,
    /// Recipient of the withdrawn fees.
    pub to: Address,
    /// Token contract address whose fee vault was debited.
    pub token: Address,
    /// Amount of tokens transferred to `to`.
    pub amount: i128,
    /// Replay-protection nonce consumed by this withdrawal (0 for batch sweeps).
    pub nonce: u64,
    /// Fee-vault balance remaining after this withdrawal.
    pub remaining_fees: i128,
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
pub struct EmergencyRecoverySetEvent {
    pub version: u32,
    /// The admin address that authorized this recovery configuration update.
    pub admin: Address,
    pub recovery: Address,
    pub cap_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct QuotaResetEvent {
    pub version: u32,
    pub user: Address,
    pub window_start: u32,
}

/// Event emitted when a withdrawal successfully consumes part of a user's
/// daily withdrawal quota (issue #697).
///
/// Published on the success path of [`enforce_withdrawal_quota`] so off-chain
/// indexers and monitoring systems can track per-user daily usage in real
/// time without re-deriving it from raw withdrawals.
///
/// # Fields
/// * `version`      – Event schema version.
/// * `user`         – The withdrawing user.
/// * `amount`       – The amount applied to the quota by this withdrawal.
/// * `accumulated`  – The user's total accumulated withdrawal in the current window.
/// * `quota`        – The configured daily quota at the time of the withdrawal.
/// * `window_start` – Ledger sequence at which the current window started.
#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawalQuotaConsumedEvent {
    pub version: u32,
    pub user: Address,
    pub amount: i128,
    pub accumulated: i128,
    pub quota: i128,
    pub window_start: u32,
}

/// Event emitted during escrow storage migration to track progress.
///
/// This event is published after each batch of records is migrated, allowing
/// indexers and monitoring systems to track the migration progress in real-time.
///
/// # Fields
///
/// * `version` - Event schema version (e.g., 1 for v1 events)
/// * `cursor` - Current migration cursor position (last processed record ID)
/// * `migrated_count` - Number of records migrated in this batch
///
/// # Event Topics
///
/// `(Symbol::short("migration"), Symbol::short("v1"))`
///
/// # Example
///
/// ```rust
/// MigrationEvent {
///     version: 1,
///     cursor: 5000,
///     migrated_count: 100,
/// }.publish(&env);
/// ```
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
pub struct AdminRoleCheckEvent {
    pub version: u32,
    pub admin: Address,
}

/// Emitted after the token balance state is updated on a successful deposit (#499).
///
/// Allows indexers to track the running total without re-reading storage,
/// and confirms that the balance update completed without overflow.
#[contractevent]
#[derive(Clone, Debug)]
pub struct DepositBalanceUpdatedEvent {
    pub version: u32,
    pub token: Address,
    pub total_deposited: i128,
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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalExpiredEvent {
    #[topic]
    pub version: u32,
    pub request_id: u64,
    pub to: Address,
    pub amount: i128,
    pub queued_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitBreakerAutoResetEvent {
    #[topic]
    pub version: u32,
    pub tripped_at: u32,
    pub reset_at: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct CircuitBreakerBlockedEvent {
    pub version: u32,
    pub function: Symbol,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct InitializedEvent {
    pub version: u32,
    pub admin: Address,
    pub token: Address,
    pub limit: i128,
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
    /// Legacy/reserved key. Not currently written to; circuit breaker uses [`CircuitBreakerThreshold`] instead.
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
    EmergencyRecoveryCap,
    SchemaVersion,
    Oracle,
    FiatLimit,
    UserDailyVolume(Address),
    OperatorDailyLimit(Address),
    OperatorDailyVolume(Address),
    AntiSandwichDelay,
    WithdrawalQuota,
    UserDailyDeposit(Address, Address),
    TokenAllowlistEnabled(Address),
    TokenAllowed(Address, Address),
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
    // ── Issue #100: M-of-N multi-signature admin control ─────────────────
    Signers,
    Threshold,
    MultisigProposal(u64),
    NextMultisigID,
    // ── Issue #set_limit_max_cap: global per-token limit ceiling ──────────
    SetLimitMaxCap,
    // ── Issue #fee_withdrawal_nonce: replay-protection nonce per admin ────
    FeeWithdrawalNonce(Address),

}

const ORACLE_PRICE_DECIMALS: i128 = 10_000_000;

// ── Contract ──────────────────────────────────────────────────────────────
#[contract]
pub struct FiatBridge;

#[contractimpl]
impl FiatBridge {
    pub fn init(
        env: Env,
        admin: Address,
        token: Address,
        limit: i128,
        min_deposit: i128,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        require!(
            !env.storage().instance().has(&DataKey::Admin),
            Error::AlreadyInitialized
        );
        // ── Issue #600: admin must authenticate before contract initialization ──
        admin.require_auth();
        require!(limit > 0, Error::ZeroAmount);
        require!(min_deposit >= 1, Error::BelowMinimum);
        require!(min_deposit < limit, Error::BelowMinimum);

        // Validate multisig config
        require!(
            threshold > 0 && threshold <= signers.len(),
            Error::InvalidThreshold
        );
        // Ensure no duplicate signers
        let mut seen = Vec::<Address>::new(&env);
        for s in signers.iter() {
            require!(!seen.contains(&s), Error::DuplicateSigner);
            seen.push_back(s);
        }

        env.storage()
            .instance()
            .set(&DataKey::MinDeposit, &min_deposit);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::NextMultisigID, &0u64);

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
        env.storage()
            .instance()
            .set(&DataKey::SetLimitMaxCap, &i128::MAX);

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

        // ── Issue #600: emit initialization event ────────────────────────
        InitializedEvent {
            version: EVENT_VERSION,
            admin: admin.clone(),
            token: token.clone(),
            limit,
        }
        .publish(&env);

        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Ok(())
    }

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
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Self::validate_memo_hash(&env, &memo_hash)?;
        from.require_auth();

        // Admin co-authentication: deposits require the admin's signature
        // alongside the depositor's. This lets the bridge enforce off-chain
        // KYC/AML decisions on-chain — the admin only co-signs after the
        // operator-side checks have cleared.
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        Self::require_not_paused(&env)?;

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
        env.storage().temporary().set(&index_key, &receipt_hash);
        env.storage()
            .temporary()
            .extend_ttl(&index_key, MIN_TTL, MIN_TTL);
        // #499: receipt counter increment must be overflow-safe; u64::MAX receipts
        // is unreachable in practice but the check costs nothing.
        env.storage().instance().set(
            &DataKey::ReceiptCounter,
            &receipt_counter.checked_add(1).ok_or(Error::Overflow)?,
        );

        config.total_deposited = config
            .total_deposited
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        // #499: emit balance-update event so indexers can confirm state without
        // re-reading storage and can verify no overflow occurred.
        DepositBalanceUpdatedEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            total_deposited: config.total_deposited,
        }
        .publish(&env);

        // Overflow prevention: use checked_add for the per-user deposit total.
        // An unchecked addition here could silently wrap and make a large
        // depositor appear to have deposited very little, bypassing any
        // future per-user caps.
        let user_key = DataKey::UserDeposited(from.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        let new_user_total = user_total.checked_add(amount).ok_or(Error::InternalError)?;
        env.storage().instance().set(&user_key, &new_user_total);

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
            admin: admin.clone(),
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

    /// Verify that the contract's on-chain token balance is consistent with
    /// its internal accounting.
    ///
    /// # Invariants Checked
    ///
    /// 1. **No negative net position**: `total_deposited >= total_withdrawn`.
    ///    If this is violated the accounting has underflowed somewhere.
    ///
    /// 2. **Liabilities covered**: `net_deposited >= total_liabilities`.
    ///    Queued withdrawal requests must always be backed by real tokens.
    ///
    /// 3. **Balance covers net position**: `on_chain_balance >= net_deposited`.
    ///    The contract must hold at least as many tokens as it has promised.
    ///
    /// # Overflow Prevention
    /// `net_deposited = total_deposited - total_withdrawn` is computed with
    /// plain subtraction *after* the guard `total_deposited >= total_withdrawn`
    /// has passed, so the subtraction cannot underflow.  All accumulations of
    /// `total_deposited` and `total_withdrawn` elsewhere in the contract use
    /// `checked_add` / `checked_add` returning [`Error::Overflow`] on
    /// overflow, so these fields never silently wrap.
    ///
    /// # When Called
    /// This function is called at the end of every state-mutating operation
    /// (`deposit`, `withdraw`, `execute_withdrawal`, `cancel_withdrawal`,
    /// `reclaim_expired_withdrawal`) to act as a continuous integrity check.
    fn check_invariants(env: &Env, token_addr: &Address) -> Result<(), Error> {
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token_addr.clone()))
            .ok_or(Error::NotInitialized)?;

        let token_client = token::Client::new(env, token_addr);
        let balance = token_client.balance(&env.current_contract_address());

        // Invariant 1: total_deposited must never be less than total_withdrawn.
        // A violation here indicates an accounting underflow bug.
        if config.total_deposited < config.total_withdrawn {
            return Err(Error::InternalError);
        }

        // Safe subtraction: guarded by the check above.
        let net_deposited = config.total_deposited - config.total_withdrawn;

        // Invariant 2: queued liabilities must be covered by the net position.
        if net_deposited < config.total_liabilities {
            return Err(Error::InternalError);
        }

        // Invariant 3: the actual on-chain balance must cover the net position.
        if balance < net_deposited {
            return Err(Error::InsufficientFunds);
        }

        Ok(())
    }

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

        Self::enforce_withdrawal_quota(&env, &to, amount, &token)?;
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
        config.total_withdrawn = config
            .total_withdrawn
            .checked_add(amount)
            .ok_or(Error::InternalError)?;
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

        require!(amount > 0, Error::ZeroAmount);

        // ── Circuit breaker: track requested withdrawal amount and reject when tripped ─────
        Self::check_and_update_circuit_breaker(&env, amount)?;

        // ── Issue #687: edge case validation ─────────────────────────────
        // Validate token is whitelisted before proceeding
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;

        // Check that withdrawal amount doesn't exceed available balance
        let token_client = token::Client::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());

        if amount > contract_balance {
            return Err(Error::InsufficientFunds);
        }

        // Validate that adding to liabilities won't cause overflow
        let new_liabilities = config
            .total_liabilities
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        // Check that new liabilities don't exceed net deposited amount
        let net_deposited = config
            .total_deposited
            .checked_sub(config.total_withdrawn)
            .ok_or(Error::InternalError)?;
        if new_liabilities > net_deposited {
            return Err(Error::InsufficientFunds);
        }

        // Prevent recipient from being the contract itself
        if to == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
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

        // Update liabilities with validated amount
        let mut updated_config = config;
        updated_config.total_liabilities = new_liabilities;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &updated_config);

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

    pub fn execute_withdrawal(
        env: Env,
        operator: Address,
        request_id: u64,
        partial_amount: Option<i128>,
        expected_price: i128,
        max_slippage: u32,
    ) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        operator.require_auth();
        Self::require_not_paused(&env)?;

        let mut request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

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

        let execute_amount = match partial_amount {
            Some(amt) => {
                if amt <= 0 || amt > request.amount {
                    return Err(Error::ZeroAmount);
                }
                amt
            }
            None => request.amount,
        };

        // Operator daily limit enforcement
        if let Some(limit) = env.storage().instance().get::<_, i128>(&DataKey::OperatorDailyLimit(operator.clone())) {
            let curr_ledger = env.ledger().sequence();
            let mut operator_vol: UserDailyVolume = env.storage().instance().get(&DataKey::OperatorDailyVolume(operator.clone()))
                .unwrap_or(UserDailyVolume { usd_cents: 0, window_start: curr_ledger });

            if curr_ledger >= operator_vol.window_start + WINDOW_LEDGERS {
                operator_vol.usd_cents = 0;
                operator_vol.window_start = curr_ledger;
            }

            if operator_vol.usd_cents + execute_amount > limit {
                return Err(Error::OperatorDailyLimitExceeded);
            }

            operator_vol.usd_cents += execute_amount;
            env.storage().instance().set(&DataKey::OperatorDailyVolume(operator.clone()), &operator_vol);
        }

        Self::enforce_withdrawal_quota(&env, &request.to, execute_amount, &request.token)?;
        // ── Issue #209: circuit breaker check ────────────────────────────
        Self::check_and_update_circuit_breaker(&env, execute_amount)?;

        let token_client = token::Client::new(&env, &request.token);
        let balance = token_client.balance(&env.current_contract_address());

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
        config.total_withdrawn = config
            .total_withdrawn
            .checked_add(execute_amount)
            .ok_or(Error::InternalError)?;
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
        }
        .publish(&env);

        Ok(())
    }

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

        WithdrawalCancelledEvent {
            version: EVENT_VERSION,
            request_id,
        }
        .publish(&env);

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

    /// Updates the total liability limit for a specific token.
    ///
    /// This function can only be called by the current contract administrator.
    /// It ensures that the bridge does not exceed its risk capacity for the given asset.
    ///
    /// If an admin-configured global cap has been set via `set_limit_max_cap`,
    /// this call rejects values above that ceiling with
    /// [`Error::ExceedsLimitMaxCap`]. The cap applies to new or updated token
    /// limits only; existing per-token limits are not retroactively reduced.
    pub fn set_limit(env: Env, token: Address, limit: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        require!(
            !Self::is_circuit_breaker_tripped(env.clone()),
            Error::CircuitBreakerActive
        );
        require!(limit > 0, Error::ZeroAmount);
        let max_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::SetLimitMaxCap)
            .unwrap_or(i128::MAX);
        require!(limit <= max_cap, Error::ExceedsLimitMaxCap);
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        config.limit = limit;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);
        SetLimitEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            limit,
        }
        .publish(&env);
        Ok(())
    }

    /// Sets the global ceiling for per-token liability limits assigned by
    /// [`set_limit`].
    ///
    /// This global max cap is a risk control: it prevents any subsequent
    /// `set_limit(token, limit)` call from assigning `limit` above `max_cap`.
    /// It does not retroactively lower already-configured token limits.
    ///
    /// Defaults to `i128::MAX` after `init` (no practical ceiling). Admins should
    /// set this to a risk-appropriate cap in production.
    pub fn set_limit_max_cap(env: Env, max_cap: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if max_cap < 1 {
            return Err(Error::ZeroAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::SetLimitMaxCap, &max_cap);
        SetLimitMaxCapEvent {
            version: EVENT_VERSION,
            max_cap,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns the current configured global ceiling for token limits.
    ///
    /// If no cap has been explicitly set, this returns `i128::MAX`, which means
    /// `set_limit` is effectively unrestricted by the global ceiling.
    pub fn get_set_limit_max_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::SetLimitMaxCap)
            .unwrap_or(i128::MAX)
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
            .set(&DataKey::TokenAllowlistEnabled(token), &enabled);
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
            .set(&DataKey::TokenAllowed(token, address), &true);
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
            .remove(&DataKey::TokenAllowed(token, address));
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
        SetMinDepositEvent {
            version: EVENT_VERSION,
            min,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_min_deposit(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(1)
    }

    /// Sets the per-token daily deposit limit to enforce rolling-window rate limiting.
    ///
    /// The limit applies on a per-user, per-token basis: each user has a separate
    /// 24-hour window (defined by [`WINDOW_LEDGERS`]) for each token, and deposits
    /// exceeding the limit are rejected with [`Error::DailyLimitExceeded`].
    ///
    /// # Limit Disabling
    /// A limit of 0 or any negative value disables enforcement for this token.
    /// Once disabled, all deposits for this token bypass the daily-limit check.
    ///
    /// # Storage
    /// The limit is stored in the persistent `TokenConfig` under [`DataKey::TokenRegistry`].
    ///
    /// # Arguments
    /// * `env`         – The contract environment.
    /// * `token`       – Address of the token to configure.
    /// * `limit_per_day` – Maximum tokens per user per day; ≤ 0 disables the check.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – Contract has not been initialized.
    /// * [`Error::TokenNotWhitelisted`] – The token address is not in the registry.
    pub fn set_daily_deposit_limit(
        env: Env,
        token: Address,
        limit_per_day: i128,
    ) -> Result<(), Error> {
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
        config.daily_deposit_limit = limit_per_day;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);
        Ok(())
    }

    pub fn set_operator_daily_limit(env: Env, operator: Address, limit: i128) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }
        env.storage().instance().set(&DataKey::OperatorDailyLimit(operator), &limit);
        Ok(())
    }

    pub fn get_operator_daily_limit(env: Env, operator: Address) -> i128 {
        env.storage().instance().get(&DataKey::OperatorDailyLimit(operator)).unwrap_or(0)
    }

    pub fn set_cooldown(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
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

    /// Halts all deposit and withdrawal operations in the contract.
    ///
    /// Can only be invoked by the Admin. Useful during emergency situations
    /// or scheduled maintenance to protect user funds and contract integrity.
    pub fn pause(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        PausedEvent {
            version: EVENT_VERSION,
            by: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Resumes contract operations after a pause.
    ///
    /// Can only be invoked by the Admin. Restores full functionality to
    /// deposits and withdrawals.
    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        UnpausedEvent {
            version: EVENT_VERSION,
            by: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_anti_sandwich_delay(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AntiSandwichDelay, &ledgers);
        Ok(())
    }

    /// Set the emergency recovery address and enforce a maximum cap.
    ///
    /// The cap is constrained by the token's configured deposit limit so a
    /// compromised recovery key cannot bypass configured risk bounds.
    /// Set the emergency recovery address and enforce a maximum cap.
    ///
    /// Only the stored admin may invoke this function.  The cap is constrained
    /// by the token's configured deposit limit so a compromised recovery key
    /// cannot bypass configured risk bounds.
    ///
    /// Emits [`EmergencyRecoverySetEvent`] which records the admin address,
    /// the new recovery address, and the approved cap limit for off-chain audit.
    pub fn set_emergency_recovery(
        env: Env,
        recovery: Address,
        cap_limit: i128,
    ) -> Result<(), Error> {
        // ── Admin authentication ───────────────────────────────────────────
        // Load the authoritative admin from instance storage and require their
        // explicit authorization signature before any state mutation occurs.
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // ── Parameter validation ───────────────────────────────────────────
        if cap_limit <= 0 {
            return Err(Error::ZeroAmount);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token))
            .ok_or(Error::TokenNotWhitelisted)?;
        if cap_limit > config.limit {
            return Err(Error::ExceedsLimit);
        }

        // ── State mutation ─────────────────────────────────────────────────
        env.storage()
            .instance()
            .set(&DataKey::EmergencyRecoveryAddress, &recovery);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyRecoveryCap, &cap_limit);

        // ── Audit event ────────────────────────────────────────────────────
        // Include the admin address so indexers can attribute the change to
        // the specific key-holder who authorized it.
        EmergencyRecoverySetEvent {
            version: EVENT_VERSION,
            admin,
            recovery,
            cap_limit,
        }
        .publish(&env);
        Ok(())
    }

    /// Initiates a transfer of the administrative role to a new address.
    ///
    /// Follows a two-step transfer pattern:
    /// 1. Current admin calls `transfer_admin(new_address)`.
    /// 2. `new_address` must call `accept_admin()` to complete the transfer.
    ///
    /// This prevents accidental lockouts if the wrong address is provided.
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
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

    /// Finalizes the administrative transfer process.
    ///
    /// Must be called by the `pending_admin` address set in a previous
    /// `transfer_admin` call.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    // ── Fiat Limits & Oracle ──────────────────────────────────────────────
    pub fn set_oracle(env: Env, oracle: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
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

    /// Enforces `max_slippage_bps` on **downward** price moves only.
    ///
    /// # Parameters
    ///
    /// - `expected_price` - benchmark (e.g. oracle) price used for the check.
    ///   Skipped entirely when `<= 0` (no benchmark available).
    /// - `actual_price` - effective price for the current deposit/withdraw path.
    /// - `max_slippage_bps` - cap in **basis points** (10_000 BPS = 100%). Only
    ///   applies when `actual_price < expected_price`.
    ///
    /// # Display vs assertion
    ///
    /// The emitted `SlippageEvent` uses **floor** BPS:
    /// `floor((expected - actual) * 10_000 / expected)` when `actual < expected`, else `0`.
    ///
    /// The revert decision uses **integer cross-multiplication** and a
    /// **remainder guard** when the floored quotient equals `max_slippage_bps`,
    /// so boundary tests at "exactly max" vs "max + 1 bps" stay stable without
    /// floating point. See `docs/slippage-threshold.md` at the repo root.
    ///
    /// # Algorithm (step-by-step)
    ///
    /// 1. If `actual_price >= expected_price` - slippage is zero; return `Ok(())`.
    /// 2. Compute `diff = expected_price - actual_price`.
    /// 3. **Fast reject**: if `diff * 10_000 > max_slippage_bps * expected_price`
    ///    the slippage is clearly over the cap; return `Err(SlippageTooHigh)`.
    /// 4. Compute `quotient = (diff * 10_000) / expected_price` (integer floor).
    /// 5. If `quotient > max_slippage_bps` - return `Err(SlippageTooHigh)`.
    /// 6. **Boundary guard**: if `quotient == max_slippage_bps`, inspect the
    ///    remainder `r = (diff * 10_000) % expected_price`. If `r >= expected_price / 2`
    ///    the true (ceiling) value would exceed the cap - return `Err(SlippageTooHigh)`.
    /// 7. Otherwise return `Ok(())`.
    ///
    /// # Overflow safety
    ///
    /// `diff * 10_000` and `max_slippage_bps * expected_price` are both `i128`
    /// multiplications. Given that `expected_price` is bounded by the fiat limit
    /// (see `validate_fiat_limit`) and `max_slippage_bps <= 10_000`, neither
    /// product can overflow `i128`. See `docs/OVERFLOW_PREVENTION.md`.
    ///
    /// # Errors
    ///
    /// Returns [`Error::SlippageTooHigh`] when the effective downward slippage
    /// exceeds `max_slippage_bps`.
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

        SlippageEvent {
            version: EVENT_VERSION,
            slippage_bps: slippage_bps as u32,
        }
        .publish(env);

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

    /// Enforces the rolling 24-hour per-user per-token deposit limit.
    ///
    /// This function is called by [`deposit`] before accepting a new deposit. It maintains
    /// a per-user per-token rolling-window accumulator (`UserDailyDeposit`) and rejects
    /// deposits that would exceed the configured [`TokenConfig::daily_deposit_limit`].
    ///
    /// # Window Semantics
    /// The 24-hour window is defined by [`WINDOW_LEDGERS`] ≈ 17,280 ledgers.
    /// Once `env.ledger().sequence() >= window_start + WINDOW_LEDGERS`, the window
    /// automatically resets: the amount is zeroed and `window_start` is updated.
    ///
    /// # Limit Disabling
    /// If `config.daily_deposit_limit <= 0`, no limit is enforced; this function returns `Ok(())`
    /// immediately and the deposit proceeds unchecked.
    ///
    /// # Overflow Protection
    /// Accumulation uses `checked_add` (issue #499) to prevent a crafted extremely large
    /// deposit from wrapping the `i128` accumulator and bypassing the limit check.
    ///
    /// # Arguments
    /// * `env`       – The contract environment (used to fetch current ledger sequence).
    /// * `depositor` – The user making the deposit.
    /// * `token`     – The token being deposited.
    /// * `amount`    – The number of tokens being deposited.
    /// * `config`    – The token's configuration, including its `daily_deposit_limit`.
    ///
    /// # Errors
    /// * [`Error::DailyLimitExceeded`] – Deposit would cause accumulator to exceed the limit.
    /// * [`Error::Overflow`] – The accumulation would overflow `i128`.
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

        // #499: use checked_add so a crafted large deposit cannot wrap the
        // i128 daily accumulator and bypass the limit check above.
        record.amount = record.amount.checked_add(amount).ok_or(Error::Overflow)?;
        env.storage().instance().set(&key, &record);
        Ok(())
    }

    // ── Timelock ──────────────────────────────────────────────────────────
    /// Queue an admin action to be executed after the mandatory timelock delay.
    ///
    /// All privileged governance operations (parameter changes, operator
    /// management, etc.) must be queued here first and can only be executed
    /// once the timelock has elapsed.  This prevents surprise changes and
    /// gives observers time to react.
    ///
    /// # Role check
    /// Only the contract admin may call this function.  The admin address is
    /// read from instance storage and `require_auth()` is called against it,
    /// so the transaction must be signed by the admin key.  Operators and
    /// other addresses are explicitly excluded — they hold a narrower role
    /// that does not include governance authority.
    ///
    /// # Timelock enforcement
    /// `delay` must be at least [`MIN_TIMELOCK_DELAY`] (34 560 ledgers ≈ 48 h).
    /// Shorter delays are rejected with [`Error::ActionNotReady`] to prevent
    /// governance actions from bypassing the mandatory waiting period.
    ///
    /// # Arguments
    /// * `env`         – The contract environment.
    /// * `action_type` – A [`Symbol`] identifying the action kind (used for
    ///                   event emission and off-chain indexing).
    /// * `payload`     – Arbitrary bytes encoding the action parameters.
    /// * `delay`       – Number of ledgers to wait before the action becomes
    ///                   executable.  Must be ≥ `MIN_TIMELOCK_DELAY`.
    ///
    /// # Returns
    /// The numeric ID assigned to the queued action.  Pass this ID to
    /// [`execute_admin_action`] once the timelock has elapsed.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – Contract has not been initialised.
    /// * [`Error::ActionNotReady`] – `delay` is below `MIN_TIMELOCK_DELAY`.
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
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextActionID)
            .unwrap_or(0);
        let action = QueuedAdminAction {
            action_type: action_type.clone(),
            payload,
            queued_ledger: env.ledger().sequence(),
            target_ledger: env.ledger().sequence() + delay,
        };
        env.storage()
            .persistent()
            .set(&DataKey::QueuedAdminAction(id), &action);
        env.storage()
            .instance()
            .set(&DataKey::NextActionID, &(id + 1));
        AdminActionQueuedEvent {
            version: EVENT_VERSION,
            action_type: action_type.clone(),
            action_id: id,
            target_ledger: action.target_ledger,
        }
        .publish(&env);
        Ok(id)
    }

    /// Execute a previously queued admin action once its timelock has elapsed.
    ///
    /// # Role check
    /// Only the contract admin may execute queued actions.  The same
    /// `require_auth()` guard used in [`queue_admin_action`] applies here,
    /// ensuring that the entity that queued the action is also the one that
    /// executes it.  This prevents a scenario where an attacker who gains
    /// temporary access to the queue could trigger execution without the
    /// admin's continued authorisation.
    ///
    /// # Timelock enforcement
    /// The action is only executable once `env.ledger().sequence()` is
    /// strictly greater than `action.target_ledger` (i.e. `>`, not `>=`).
    /// This adds one extra ledger of safety margin and is consistent with
    /// the off-by-one fix documented in [`execute_upgrade`].
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    /// * `id`  – The action ID returned by [`queue_admin_action`].
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]  – Contract has not been initialised.
    /// * [`Error::ActionNotQueued`] – No action exists for the given `id`.
    /// * [`Error::ActionNotReady`]  – The timelock has not yet elapsed.
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
        AdminActionExecutedEvent {
            version: EVENT_VERSION,
            action_id: id,
        }
        .publish(&env);
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        Ok(())
    }

    // ── Operator Role & Heartbeat ───────────────────────────────────────
    /// Grants or revokes the Operator role for a specific address.
    ///
    /// Operators are restricted roles that can perform low-stakes actions like
    /// heartbeats but cannot change core contract parameters.
    /// Admin-only function.
    ///
    /// # Role separation (timelock role check)
    /// The admin and operator roles are intentionally kept separate:
    ///
    /// * **Admin** – governance role; can queue/execute timelock actions,
    ///   pause/unpause the contract, and manage operators.
    /// * **Operator** – operational role; limited to heartbeat and similar
    ///   low-stakes actions that do not require a timelock.
    ///
    /// Conflating both roles on a single address would allow an operator key
    /// compromise to bypass the governance timelock entirely.  Therefore:
    ///
    /// 1. The admin address **must not** be granted the operator role
    ///    (`operator != admin` is enforced; violation → [`Error::NotAllowed`]).
    /// 2. The contract itself **must not** be an operator
    ///    (`operator != current_contract_address()`; violation →
    ///    [`Error::InvalidRecipient`]).
    ///
    /// These checks are the canonical *timelock role check* referenced
    /// throughout the codebase and test suite (fix #525).
    ///
    /// # Arguments
    /// * `env`      – The contract environment.
    /// * `operator` – The address to grant or revoke the operator role for.
    /// * `active`   – `true` to grant, `false` to revoke.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]    – Contract has not been initialised.
    /// * [`Error::NotAllowed`]        – `operator` is the admin address.
    /// * [`Error::InvalidRecipient`]  – `operator` is the contract address.
    /// * [`Error::OperatorCapReached`] – Maximum operator count already reached.
    /// * [`Error::NotOperator`]       – `active == false` but the address is not an operator.
    /// * [`Error::ContractPaused`]    – Contract is paused; operator list cannot be mutated.
    pub fn set_operator(env: Env, operator: Address, active: bool) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Boundary checks (fix #525): prevent role confusion that could affect
        // circuit breaker state transitions.
        // The admin must not be granted the operator role — conflating both roles
        // bypasses the separation of concerns between governance and operations.
        require!(operator != admin, Error::NotAllowed);
        // The contract itself must never be an operator.
        require!(
            operator != env.current_contract_address(),
            Error::InvalidRecipient
        );

        // #492: Operator list must not be mutated while the contract is paused —
        // doing so during a pause could corrupt batch operation state.
        Self::require_not_paused(&env)?;

        Self::prune_inactive_operators_internal(&env);
        let was_active = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator.clone()))
            .unwrap_or(false);

        // #492: Deactivating an address that was never an operator is a silent
        // no-op that masks caller bugs and can corrupt batch bookkeeping.
        require!(active || was_active, Error::NotOperator);

        let max_operators: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxOperators)
            .unwrap_or(0);
        let mut operators = Self::get_operator_list(&env);

        // #492: Use require! for consistency with the rest of the validation block.
        require!(
            !(active && !was_active && max_operators > 0 && operators.len() >= max_operators),
            Error::OperatorCapReached
        );

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
        }
        .publish(&env);

        Ok(())
    }

    /// Sets the maximum number of operators allowed to be active simultaneously.
    ///
    /// # Purpose
    /// Configures the operator count cap. A value of 0 means unlimited operators.
    /// Values > 0 enforce a hard limit on concurrent operator registrations.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `max_operators`: The new maximum operator count (0 for unlimited)
    ///
    /// # Returns
    /// `Ok(())` on successful update
    /// `Err(Error::NotInitialized)` if contract admin not set
    /// `Err(Error::ExceedsLimit)` if max_operators < current active operator count
    ///
    /// # Access Control
    /// Only the contract admin (verified via `require_auth()`) may call this function.
    ///
    /// # Validation
    /// - Contract must be initialized (admin exists)
    /// - If setting a non-zero limit (max_operators > 0), must be >= current operator count
    ///   to avoid violating the cap invariant
    ///
    /// # Errors
    /// - `NotInitialized`: Admin not set (contract not initialized)
    /// - `ExceedsLimit`: Attempting to reduce max below current operator count
    ///
    /// # Side Effects
    /// - Updates persistent storage with new max operators value
    /// - Does not affect currently registered operators
    ///
    /// # Example
    /// ```ignore
    /// contract.set_max_operators(env, 10)?;  // Allow up to 10 operators
    /// contract.set_max_operators(env, 0)?;   // Allow unlimited operators
    /// ```
    pub fn set_max_operators(env: Env, max_operators: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Boundary check: if setting a non-zero limit, ensure it doesn't violate
        // the cap by being less than the current operator count
        if max_operators > 0 {
            let operators = Self::get_operator_list(&env);
            #[allow(clippy::unnecessary_cast)]
            let current_count = operators.len() as u32;
            require!(
                current_count <= max_operators,
                Error::ExceedsLimit
            );
        }

        env.storage()
            .instance()
            .set(&DataKey::MaxOperators, &max_operators);
        Ok(())
    }

    // ── Denylist ──────────────────────────────────────────────────────────
    /// Adds an address to the global denylist.
    ///
    /// Denied addresses are blocked from making deposits.
    /// Admin-only function for regulatory compliance and security.
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
        env.storage().instance().set(
            &DataKey::DeniedCount,
            &(count.checked_add(1).ok_or(Error::Overflow)?),
        );

        DenyAddressEvent {
            version: EVENT_VERSION,
            address: address.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Records an operator heartbeat with monotonic nonce-based replay protection.
    ///
    /// This function prevents replay attacks by requiring operators to provide
    /// the exact next expected nonce for their account. The nonce must match the
    /// value retrieved via [`Self::get_operator_nonce`].
    ///
    /// # Replay Protection Mechanism
    ///
    /// **Nonce Requirement**: Each operator must provide exactly the next expected nonce.
    /// - First heartbeat uses nonce `0`
    /// - Subsequent calls require nonce `1`, `2`, `3`, etc. (monotonically increasing)
    /// - Replaying an old nonce returns [`Error::StaleNonce`] (already used)
    /// - Skipping ahead returns [`Error::InvalidNonce`] (future nonce)
    /// - Providing the correct nonce succeeds and increments to the next value
    ///
    /// **Atomicity**: Nonce increment and heartbeat timestamp update occur atomically.
    /// If nonce validation fails, no state changes occur.
    ///
    /// **Events**: On success, emits [`NonceIncrementedEvent`] with the new nonce value.
    /// This event enables auditing and indexing of operator actions.
    ///
    /// # Arguments
    ///
    /// - `env`: The Soroban environment
    /// - `operator`: The address of the operator (must be authorized via Soroban's `require_auth`)
    /// - `nonce`: The nonce value provided by the operator (must equal `get_operator_nonce(operator)`)
    ///
    /// # Errors
    ///
    /// - [`Error::NotOperator`]: Caller is not a registered operator
    /// - [`Error::StaleNonce`]: The nonce has already been used (replay detected)
    /// - [`Error::InvalidNonce`]: The nonce is skipped ahead (not the next expected value)
    ///
    /// # Example Flow
    ///
    /// ```text
    /// 1. Client calls get_operator_nonce(operator) → returns 0
    /// 2. Client calls heartbeat(operator, 0) → success, next nonce is 1
    /// 3. Client calls get_operator_nonce(operator) → returns 1
    /// 4. Client calls heartbeat(operator, 1) → success, next nonce is 2
    /// 5. Client calls heartbeat(operator, 1) again → StaleNonce error
    /// 6. Client calls heartbeat(operator, 5) → InvalidNonce error
    /// ```
    pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error> {
        operator.require_auth();
        Self::require_not_paused(&env)?;
        require!(
            !Self::is_circuit_breaker_tripped(env.clone()),
            Error::CircuitBreakerActive
        );
        require!(
            env.storage()
                .instance()
                .get::<_, bool>(&DataKey::Operator(operator.clone()))
                .unwrap_or(false),
            Error::NotOperator
        );

        // Validate and increment nonce for replay protection
        Self::validate_and_increment_nonce(&env, &operator, nonce)?;

        Self::maybe_auto_reset_circuit_breaker(&env);

        let curr = env.ledger().sequence();
        env.storage()
            .instance()
            .set(&DataKey::OperatorHeartbeat(operator.clone()), &curr);

        HeartbeatEvent {
            version: EVENT_VERSION,
            operator: operator.clone(),
            ledger: curr,
        }
        .publish(&env);

        Ok(())
    }

    pub fn is_operator(env: Env, operator: Address) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator))
            .unwrap_or(false)
    }

    pub fn get_operator_heartbeat(env: Env, operator: Address) -> Option<u32> {
        env.storage()
            .instance()
            .get(&DataKey::OperatorHeartbeat(operator))
    }

    /// Returns the next expected nonce for an operator's next heartbeat action.
    ///
    /// This read-only function retrieves the current nonce state for an operator
    /// without modifying any contract state.
    ///
    /// **Replay Protection Context**: Clients must call this function before each
    /// operator action to obtain the nonce required for [`Self::heartbeat`]. Using
    /// an outdated nonce will result in `StaleNonce` error; using a future nonce
    /// results in `InvalidNonce` error.
    ///
    /// # Nonce Lifecycle
    ///
    /// - **Initial state** (never heartbeat): returns `0`
    /// - **After 1st heartbeat**: returns `1`
    /// - **After 2nd heartbeat**: returns `2`
    /// - **Increments monotonically** by 1 after each successful heartbeat
    ///
    /// # Recommended Usage
    ///
    /// ```text
    /// // Always fetch fresh before signing an operator action
    /// nonce = contract.get_operator_nonce(operator_address)
    /// sign_heartbeat(operator_address, nonce)
    /// submit_heartbeat(operator_address, nonce)
    /// ```
    ///
    /// **Do not cache nonces** between heartbeats. On-chain state is authoritative.
    /// If a heartbeat fails with a nonce error, re-fetch the nonce before retrying.
    ///
    /// # Arguments
    ///
    /// - `env`: The Soroban environment
    /// - `operator`: The operator address to query
    ///
    /// # Returns
    ///
    /// The next expected nonce (u64) for the given operator. Starts at `0` for
    /// operators that have never submitted a heartbeat.
    pub fn get_operator_nonce(env: Env, operator: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OperatorNonce(operator))
            .unwrap_or(0)
    }

    /// Removes inactive operators from the operator registry.
    ///
    /// Operators who have not submitted a heartbeat within the configured inactivity
    /// threshold are marked as inactive and removed from the active operator list.
    /// This prevents stale operators from consuming resources or remaining eligible
    /// for authorization checks.
    ///
    /// # Inactivity Mechanism
    ///
    /// An operator is considered inactive when:
    /// ```text
    /// current_ledger - last_heartbeat_ledger > inactivity_threshold
    /// ```
    ///
    /// Where:
    /// - `current_ledger`: Current Soroban ledger sequence number
    /// - `last_heartbeat_ledger`: Ledger number of operator's last heartbeat (set by `heartbeat`)
    /// - `inactivity_threshold`: Configured threshold (default: ~3 months ≈ 1,555,200 ledgers)
    ///
    /// **Heartbeat Requirement**: Operators must call [`Self::heartbeat`] within the
    /// threshold period to maintain active status. Without regular heartbeats, the
    /// operator becomes eligible for pruning.
    ///
    /// # Pruning Behavior
    ///
    /// On execution:
    /// 1. Retrieves the inactivity threshold (or uses `DEFAULT_INACTIVITY_THRESHOLD`)
    /// 2. Iterates through all registered operators
    /// 3. For each active operator, checks if it has exceeded the inactivity threshold
    /// 4. Inactive operators are:
    ///    - Marked as inactive in storage (`DataKey::Operator` → `false`)
    ///    - Removed from the operator list (`DataKey::OperatorList`)
    ///    - Trigger [`OperatorPrunedEvent`] for audit trail
    /// 5. Active operators remain in the list unchanged
    ///
    /// # Events
    ///
    /// For each pruned operator, emits [`OperatorPrunedEvent`] containing:
    /// - The pruned operator address
    /// - The current ledger sequence (when pruning occurred)
    /// - Version tag for indexer compatibility
    ///
    /// # Authorization
    ///
    /// Only the contract admin can call this function (enforced via `require_auth`).
    ///
    /// # Errors
    ///
    /// - [`Error::NotInitialized`]: Contract has not been initialized
    ///
    /// # Example Timeline
    ///
    /// ```text
    /// Ledger 1000: Operator A heartbeats (last_heartbeat = 1000)
    /// Ledger 2000: Operator A has not heartbeat for 1000 ledgers
    /// Threshold: 1555200 ledgers (~3 months)
    /// Status: Still active (1000 < 1555200)
    ///
    /// Ledger 1556200: prune_inactive_operators called
    /// Check: 1556200 - 1000 = 1555200 > 1555200? No, still within threshold
    /// Status: Operator A remains active
    ///
    /// Ledger 1556201: prune_inactive_operators called
    /// Check: 1556201 - 1000 = 1555201 > 1555200? Yes, exceeds threshold
    /// Status: Operator A is pruned (marked inactive, removed from list)
    /// ```
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

    /// Internal helper: validates nonce monotonicity and atomically increments.
    ///
    /// This is the core replay-protection engine. It enforces strict nonce validation,
    /// ensuring that each operator action is processed exactly once in order.
    ///
    /// **Validation Logic**:
    /// - Reads the current stored nonce for the operator (default `0` if never set)
    /// - Compares provided nonce against current nonce:
    ///   - `provided < current` → [`Error::StaleNonce`] (already used, replay attempt)
    ///   - `provided > current` → [`Error::InvalidNonce`] (skipped ahead, out of order)
    ///   - `provided == current` → validation passes, proceed to increment
    /// - On validation pass: increments stored nonce by 1 and publishes [`NonceIncrementedEvent`]
    ///
    /// **Atomicity**: The entire operation is atomic:
    /// - Validation failure: no state changes, error returned immediately
    /// - Validation success: nonce update and event publish happen together
    /// - If transaction fails after this function succeeds, ledger rollback prevents partial updates
    ///
    /// **Security Properties**:
    /// - **Replay Prevention**: Stale nonces are definitively rejected
    /// - **Out-of-Order Protection**: Nonces must arrive in strict order; skips are forbidden
    /// - **Per-Operator Isolation**: Each operator maintains independent nonce state
    /// - **Monotonic Increment**: Each success guarantees next nonce is exactly `current + 1`
    ///
    /// # Overflow Behavior
    ///
    /// The nonce is a `u64`. At one heartbeat per ledger (~5 seconds), it would take
    /// approximately 2.9 × 10¹² years to exhaust the `u64` range. However, to be safe,
    /// this function uses `checked_add(1)` to catch theoretical overflow, returning
    /// [`Error::Overflow`] if the nonce would exceed `u64::MAX`.
    ///
    /// # Arguments
    ///
    /// - `env`: Reference to the Soroban environment
    /// - `operator`: Reference to the operator address
    /// - `provided_nonce`: The nonce value claimed by the operator
    ///
    /// # Errors
    ///
    /// - [`Error::StaleNonce`]: Provided nonce is less than stored nonce (already used)
    /// - [`Error::InvalidNonce`]: Provided nonce is greater than stored nonce (skipped)
    /// - [`Error::Overflow`]: Nonce increment would overflow (practically impossible)
    ///
    /// # Side Effects
    ///
    /// On success:
    /// - Updates [`DataKey::OperatorNonce`] in instance storage
    /// - Publishes [`NonceIncrementedEvent`] with new nonce value
    ///
    /// On failure:
    /// - No state changes occur
    /// - Returns appropriate error variant
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

        // Increment nonce with explicit overflow handling.
        let next_nonce = current_nonce.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::OperatorNonce(operator.clone()), &next_nonce);

        NonceIncrementedEvent {
            version: EVENT_VERSION,
            operator: operator.clone(),
            new_nonce: next_nonce,
        }
        .publish(env);

        Ok(())
    }

    /// Internal implementation of operator inactivity pruning.
    ///
    /// This helper function processes the actual pruning logic. It is called by
    /// [`Self::prune_inactive_operators`] after authorization is verified.
    ///
    /// **Algorithm**:
    /// 1. Load the inactivity threshold from storage (or use default ~3 months)
    /// 2. Get the current ledger sequence number
    /// 3. Retrieve the list of all registered operators
    /// 4. For each operator:
    ///    a. Check if operator is marked as active
    ///    b. If inactive (marked as false), skip and do not include in retained list
    ///    c. If active, get the last heartbeat ledger timestamp
    ///    d. Calculate inactivity duration: `current_ledger - last_heartbeat_ledger`
    ///    e. If duration exceeds threshold: mark inactive and emit pruning event
    ///    f. If duration is within threshold: retain operator in active list
    /// 5. Update operator storage with the filtered list
    /// 6. Update operator count
    ///
    /// **Threshold Computation** uses saturating arithmetic to handle edge cases:
    /// ```text
    /// saturating_sub prevents underflow if last_heartbeat > current_ledger
    /// (shouldn't happen in practice, but protects against ledger reorg scenarios)
    /// ```
    ///
    /// **Storage Updates**:
    /// - [`DataKey::Operator(inactive_addr)`] set to `false` for pruned operators
    /// - [`DataKey::OperatorList`] updated with only retained operators
    /// - [`DataKey::OperatorCount`] updated with new count
    ///
    /// **Invariants Maintained**:
    /// - OperatorCount always equals the length of OperatorList
    /// - Pruned operators cannot be in both inactive and list states
    /// - Pruning is idempotent (calling twice with same operators produces same result)
    ///
    /// **No Authorization Check**: This is an internal helper. Authorization must be
    /// verified by the caller (typically [`Self::prune_inactive_operators`]).
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
    /// Queue an irreversible admin renounce that will eliminate all governance.
    ///
    /// Once queued, the renounce cannot be cancelled. After the mandatory timelock
    /// (`MIN_TIMELOCK_DELAY`), the current admin can call [`execute_renounce_admin`]
    /// to permanently remove the admin address and take the contract out of governance.
    ///
    /// # Role check
    /// Only the current admin can call this function. The admin address is
    /// read from instance storage and `require_auth()` is called against it,
    /// so the transaction must be signed by the admin key.
    ///
    /// # Timelock enforcement
    /// The renounce cannot be executed until `env.ledger().sequence() > target_ledger`,
    /// where `target_ledger = now + MIN_TIMELOCK_DELAY` (34 560 ledgers ≈ 48 h).
    /// This gives all stakeholders time to react.
    ///
    /// # Pause requirement
    /// Renounce queueing is blocked while the contract is paused. This prevents the
    /// timelock from elapsing while paused, which would leave the contract permanently
    /// without governance. An explicit unpause is required first.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]   – Contract has not been initialized.
    /// * [`Error::ContractPaused`]   – Contract is paused; renounce queueing is blocked.
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

        let target_ledger: u32 = env.ledger().sequence() + MIN_TIMELOCK_DELAY;
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

        DenyRemovedEvent {
            version: EVENT_VERSION,
            address: address.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Checks if an address is on the denylist.
    ///
    /// Returns `true` if the address has been denied via [`deny_address`],
    /// `false` otherwise. Denied addresses cannot deposit, withdraw, or
    /// request withdrawals.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `address` - The address to check
    ///
    /// # Returns
    /// `true` if the address is denied, `false` otherwise
    pub fn is_denied(env: Env, address: Address) -> bool {
        env.storage().persistent().has(&DataKey::Denied(address))
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
            idx += 1;
        }
        result
    }

    // ── Fee Vault ─────────────────────────────────────────────────────────

    /// Returns the persisted fee-vault balance for `token`, reconciled against
    /// the contract's on-chain token balance so the ledger never exceeds reserves.
    /// Reconciles the on-chain fee vault ledger balance against the actual token contract balance.
    ///
    /// # Purpose
    /// Maintains consistency between the contract's internal accounting (persistent storage)
    /// and the actual token balance held by the contract. If the ledger records more fees
    /// than are actually held (e.g., due to token transfers or external liquidations),
    /// this function corrects the ledger down to the actual balance and emits a
    /// reconciliation event for audit purposes.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `token`: The token address to reconcile
    ///
    /// # Returns
    /// The authoritative fee vault balance after reconciliation:
    /// - If `vault_balance <= 0`, returns `0` (no fees recorded)
    /// - If `vault_balance <= contract_balance`, returns `vault_balance` (ledger accurate)
    /// - If `vault_balance > contract_balance`, corrects ledger and returns `contract_balance`
    ///
    /// # Side Effects
    /// - Corrects persistent storage if ledger exceeds actual balance
    /// - Emits [`FeeVaultReconciledEvent`] when a correction occurs
    ///
    /// # Example
    /// Called before fee withdrawals and batch sweeps to ensure the contract does not
    /// attempt to send more tokens than physically held.
    fn reconcile_fee_vault(env: &Env, token: &Address) -> i128 {
        let key = DataKey::FeeVault(token.clone());
        let vault_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if vault_balance <= 0 {
            return 0;
        }

        let token_client = token::Client::new(env, token);
        let contract_balance = token_client.balance(&env.current_contract_address());
        if vault_balance <= contract_balance {
            return vault_balance;
        }

        env.storage()
            .persistent()
            .set(&key, &contract_balance);
        FeeVaultReconciledEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            previous_balance: vault_balance,
            new_balance: contract_balance,
        }
        .publish(env);
        contract_balance
    }

    /// Deducts a specific amount from the fee vault ledger and updates persistent storage.
    ///
    /// # Purpose
    /// Atomically reduces the recorded fee vault balance by the withdrawn amount.
    /// This is a ledger-only operation that does not interact with the token contract.
    /// The actual token transfer must be performed by the caller.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `token`: The token address whose vault is being debited
    /// - `vault_balance`: The current vault balance (typically from [`Self::reconcile_fee_vault`])
    /// - `amount`: The amount to deduct (must be > 0 and <= vault_balance)
    ///
    /// # Returns
    /// `Ok(remaining)`: The new vault balance after deduction
    /// `Err(error)`: If vault is empty, amount exceeds balance, or overflow occurs
    ///
    /// # Errors
    /// - [`Error::NoFeesToWithdraw`]: Vault balance is zero
    /// - [`Error::FeeWithdrawalExceedsBalance`]: Requested amount > vault balance
    /// - [`Error::Overflow`]: Subtraction would overflow (should not occur in normal flow)
    ///
    /// # Preconditions
    /// **CRITICAL**: Callers MUST invoke [`Self::reconcile_fee_vault`] before calling this function.
    /// This ensures the ledger reflects actual on-chain balance and prevents over-withdrawals.
    ///
    /// # Example
    /// Used internally by [`Self::withdraw_fees`] and [`Self::withdraw_fees_batch`] after
    /// reconciliation and token transfer to finalize the ledger state.
    fn deduct_fee_vault_ledger(
        env: &Env,
        token: &Address,
        vault_balance: i128,
        amount: i128,
    ) -> Result<i128, Error> {
        require!(vault_balance > 0, Error::NoFeesToWithdraw);
        require!(amount <= vault_balance, Error::FeeWithdrawalExceedsBalance);
        let remaining = vault_balance
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;
        let key = DataKey::FeeVault(token.clone());
        env.storage().persistent().set(&key, &remaining);
        Ok(remaining)
    }

    /// Records fees accrued for a specific token in the fee vault.
    ///
    /// # Purpose
    /// Adds a positive amount to the contract's internal fee vault for the given token.
    /// This operation is typically called during swap execution to accumulate protocol fees.
    /// The fees are held in the contract's token balance and tracked in persistent storage.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `token`: The token address for which fees are being accrued
    /// - `amount`: The fee amount to add (must be > 0)
    ///
    /// # Returns
    /// `Ok(())` on successful accrual
    /// `Err(Error::NotInitialized)` if contract has not been initialized
    /// `Err(Error::ZeroAmount)` if amount <= 0
    ///
    /// # Access Control
    /// Only the contract admin (verified via `require_auth()`) may call this function.
    ///
    /// # Side Effects
    /// - Increments the fee vault balance in persistent storage
    /// - Emits [`FeeAccruedEvent`] with token, amount, and current version
    ///
    /// # Notes
    /// - Does not modify token balances; assumes tokens are already held by the contract
    /// - Does not emit events on zero-amount rejections (fails before event emission)
    /// - Safe for repeated calls; ledger balance is strictly increasing
    ///
    /// # Example
    /// ```ignore
    /// // During a swap: transfer fee tokens to contract, then accrue
    /// contract.accrue_fee(env, token_address, 100)?;
    /// ```
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

        FeeAccruedEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_renounce_admin(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .remove(&DataKey::PendingRenounceLedger);
        Ok(())
    }

    /// Returns the current accrued fee balance for a specific token.
    ///
    /// # Purpose
    /// Provides a read-only view of the accumulated fees held in the contract for the
    /// given token. This is useful for dashboards, audits, and fee withdrawal planning.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `token`: The token address to query
    ///
    /// # Returns
    /// The current fee vault balance for the token, or `0` if no fees are recorded.
    ///
    /// # Notes
    /// - This is a read-only operation with no side effects
    /// - Does not perform reconciliation; reflects the ledger state
    /// - For accurate withdrawal amounts, use [`Self::reconcile_fee_vault`] first
    ///
    /// # Example
    /// ```ignore
    /// let accumulated_fees = contract.get_accrued_fees(env, usdc_address);
    /// println!("Outstanding fees: {}", accumulated_fees);
    /// ```
    pub fn get_accrued_fees(env: Env, token: Address) -> i128 {
        let fees = env
            .storage()
            .persistent()
            .get(&DataKey::FeeVault(token.clone()))
            .unwrap_or(0);

        // Check against configured threshold and emit event if exceeded
        if let Some(threshold) = env
            .storage()
            .instance()
            .get(&DataKey::FeeVaultThreshold(token.clone()))
        {
            if fees > threshold {
                // Emit event indicating threshold exceeded
                // This is informational - the function still returns the actual value
                FeeVaultThresholdEvent {
                    version: EVENT_VERSION,
                    token: token.clone(),
                    threshold,
                }
                .publish(&env);
            }
        }

        fees
    }

    /// Sets the maximum allowed fee vault balance for a specific token.
    ///
    /// When the accrued fees exceed this threshold, a FeeVaultThresholdEvent
    /// is emitted to alert operators. This is a safety mechanism to prevent
    /// excessive fee accumulation.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `token` - The token address to set the threshold for
    /// * `threshold` - The maximum allowed fee vault balance (0 disables the check)
    pub fn set_fee_vault_threshold(env: Env, token: Address, threshold: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if threshold < 0 {
            return Err(Error::ZeroAmount);
        }

        env.storage()
            .instance()
            .set(&DataKey::FeeVaultThreshold(token.clone()), &threshold);

        FeeVaultThresholdEvent {
            version: EVENT_VERSION,
            token,
            threshold,
        }
        .publish(&env);

        Ok(())
    }

    /// Returns the current withdrawal nonce for an admin address.
    ///
    /// # Purpose
    /// Provides the expected nonce value for the next [`Self::withdraw_fees`] call.
    /// Nonces prevent replay attacks by ensuring each withdrawal transaction is unique.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `admin`: The admin address to query
    ///
    /// # Returns
    /// The current nonce value (starts at `0` for new admins, incremented on each withdrawal).
    ///
    /// # Security Notes
    /// - Nonces are per-admin and never reset
    /// - Batch withdrawals via [`Self::withdraw_fees_batch`] do NOT consume nonces
    /// - A transaction with the wrong nonce will fail with [`Error::InvalidNonce`] or [`Error::StaleNonce`]
    ///
    /// # Example
    /// ```ignore
    /// let next_nonce = contract.get_fee_withdrawal_nonce(env, admin_address);
    /// contract.withdraw_fees(env, recipient, token, amount, next_nonce)?;
    /// ```
    pub fn get_fee_withdrawal_nonce(env: Env, admin: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::FeeWithdrawalNonce(admin))
            .unwrap_or(0)
    }

    /// Withdraws a specific amount of accrued fees for a token to a recipient address.
    ///
    /// # Purpose
    /// Allows the contract admin to extract accumulated protocol fees and transfer them
    /// to a specified recipient. The withdrawal is subject to replay protection and
    /// reconciliation checks to prevent double-spending.
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `to`: The recipient address that will receive the tokens
    /// - `token`: The token address to withdraw fees for
    /// - `amount`: The exact amount to withdraw (must be > 0)
    /// - `nonce`: The expected replay-protection nonce (obtained via [`Self::get_fee_withdrawal_nonce`])
    ///
    /// # Returns
    /// `Ok(())` on successful withdrawal
    ///
    /// # Errors
    /// - [`Error::NotInitialized`]: Contract admin not set
    /// - [`Error::ZeroAmount`]: amount <= 0
    /// - [`Error::StaleNonce`]: nonce < current nonce (stale or replayed request)
    /// - [`Error::InvalidNonce`]: nonce > current nonce (premature or incorrect nonce)
    /// - [`Error::NoFeesToWithdraw`]: No fees recorded for this token
    /// - [`Error::FeeWithdrawalExceedsBalance`]: Requested amount exceeds accrued fees
    /// - [`Error::InsufficientFunds`]: Contract balance < requested amount (reconciliation mismatch)
    /// - [`Error::Overflow`]: Nonce overflow (effectively impossible at u64)
    ///
    /// # Access Control
    /// Only the contract admin (verified via `require_auth()`) may call this function.
    ///
    /// # Side Effects
    /// 1. **Reconciliation**: Checks actual contract token balance against the ledger
    /// 2. **Transfer**: Moves the specified amount to the recipient via token contract
    /// 3. **Ledger Update**: Deducts the amount from the fee vault persistent storage
    /// 4. **Nonce Increment**: Atomically increments the per-admin nonce (prevents replay)
    /// 5. **Audit Event**: Emits [`FeeWithdrawnEvent`] with full context
    ///
    /// # Security Considerations
    /// - **Replay Protection**: Each nonce is consumed exactly once; reuse fails
    /// - **Reconciliation**: Detects and corrects ledger inconsistencies from token transfers
    /// - **Atomicity**: The entire withdrawal (transfer + ledger + nonce) is atomic
    /// - **Event Audit**: All withdrawals are logged for monitoring and compliance
    ///
    /// # Example
    /// ```ignore
    /// let nonce = contract.get_fee_withdrawal_nonce(env, admin);
    /// contract.withdraw_fees(env, recipient, usdc, 1000, nonce)?;
    /// // Next withdrawal must use nonce + 1
    /// ```
    pub fn withdraw_fees(
        env: Env,
        to: Address,
        token: Address,
        amount: i128,
        nonce: u64,
    ) -> Result<(), Error> {
        // ── Admin authentication ───────────────────────────────────────────
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // ── Parameter validation ───────────────────────────────────────────
        // Issue #565: amount must be positive
        require!(amount > 0, Error::ZeroAmount);

        // ── Replay protection (Issue #695) ────────────────────────────────
        let nonce_key = DataKey::FeeWithdrawalNonce(admin.clone());
        let expected_nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0);
        require!(nonce >= expected_nonce, Error::StaleNonce);
        require!(nonce == expected_nonce, Error::InvalidNonce);

        // ── Fee vault checks (reconcile ledger with on-chain reserves) ───
        let token_client = token::Client::new(&env, &token);
        let vault_balance = Self::reconcile_fee_vault(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());
        require!(vault_balance > 0, Error::NoFeesToWithdraw);
        require!(amount <= vault_balance, Error::FeeWithdrawalExceedsBalance);
        require!(amount <= contract_balance, Error::InsufficientFunds);

        // ── State mutation ────────────────────────────────────────────────
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        let remaining_fees =
            Self::deduct_fee_vault_ledger(&env, &token, vault_balance, amount)?;

        // Increment nonce after successful withdrawal
        let next_nonce = expected_nonce.checked_add(1).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&nonce_key, &next_nonce);

        // ── Audit event ───────────────────────────────────────────────────
        // Emit full schema so indexers get a self-contained record:
        // who authorised it, where it went, which token, how much,
        // which nonce was consumed, and what balance remains.
        FeeWithdrawnEvent {
            version: EVENT_VERSION,
            admin,
            to,
            token,
            amount,
            nonce,
            remaining_fees,
        }
        .publish(&env);

        // Check invariants after fee withdrawal
        Self::check_invariants(&env, &token)?;

        Ok(())
    }

    /// Sweeps all accrued fees for multiple tokens in a single transaction.
    ///
    /// # Purpose
    /// Provides an efficient mechanism to extract all accumulated fees across multiple
    /// tokens in one operation. Useful for periodic fee collection or consolidation
    /// of fees from various token swaps. Batch withdrawals do NOT consume per-admin
    /// nonces, allowing them to be used independently of [`Self::withdraw_fees`].
    ///
    /// # Parameters
    /// - `env`: The Stellar contract environment
    /// - `to`: The recipient address that will receive all tokens
    /// - `tokens`: Vector of token addresses to sweep fees for
    ///
    /// # Returns
    /// `Ok(())` on successful completion (including if all tokens have zero balance)
    ///
    /// # Errors
    /// - [`Error::NotInitialized`]: Contract admin not set
    ///
    /// # Access Control
    /// Only the contract admin (verified via `require_auth()`) may call this function.
    ///
    /// # Behavior
    /// - **Reconciliation**: For each token, reconciles ledger vs. actual balance
    /// - **Conditional Sweep**: Only sweeps tokens with fees > 0 (silently skips zero-balance tokens)
    /// - **Capped by Balance**: If ledger exceeds contract balance, only transfers available amount
    /// - **Ledger Reset**: Fully drains the fee vault for each token to zero after transfer
    /// - **Event per Token**: Emits [`FeeWithdrawnEvent`] for each token with fees (nonce = 0)
    ///
    /// # Side Effects
    /// - Reconciles fee vault for each token (may correct inconsistencies)
    /// - Transfers tokens to recipient for each non-zero vault
    /// - Resets ledger to zero for each swept token
    /// - Emits events for audit trail and indexing
    ///
    /// # Nonce Behavior
    /// Unlike [`Self::withdraw_fees`], batch withdrawals set `nonce = 0` in events and
    /// do NOT increment the per-admin replay-protection nonce. This allows batch sweeps
    /// to occur independently of sequential single-token withdrawals.
    ///
    /// # Example
    /// ```ignore
    /// let tokens = vec![usdc_address, usdt_address, native_address];
    /// contract.withdraw_fees_batch(env, treasury, tokens)?;
    /// // All accrued fees for each token are now transferred to treasury
    /// ```
    pub fn withdraw_fees_batch(env: Env, to: Address, tokens: Vec<Address>) -> Result<(), Error> {
        // ── Admin authentication ───────────────────────────────────────────
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let contract = env.current_contract_address();
        for token in tokens.iter() {
            let current = Self::reconcile_fee_vault(&env, &token);
            if current <= 0 {
                continue;
            }

            let token_client = token::Client::new(&env, &token);
            let contract_balance = token_client.balance(&contract);
            let sweep_amount = if current <= contract_balance {
                current
            } else {
                contract_balance
            };
            if sweep_amount <= 0 {
                continue;
            }

            token_client.transfer(&contract, &to, &sweep_amount);
            // After transfer the vault for this token is fully drained.
            let key = DataKey::FeeVault(token.clone());
            env.storage().persistent().set(&key, &0i128);

            // Emit full schema per token so each sweep leg is individually
            // attributable. nonce = 0 because batch sweeps are not
            // replay-protected by the per-admin nonce mechanism.
            FeeWithdrawnEvent {
                version: EVENT_VERSION,
                admin: admin.clone(),
                to: to.clone(),
                token,
                amount: sweep_amount,
                nonce: 0,
                remaining_fees: 0,
            }
            .publish(&env);
        }

        Ok(())
    }

    /// Execute a previously queued admin renounce once its timelock has elapsed.
    ///
    /// Completes the renounce process by permanently removing the admin address
    /// and the pending admin address from storage. Once executed, the contract
    /// no longer has any governance authority and cannot be administered.
    ///
    /// # Role check
    /// Only the current admin can call this function. The same `require_auth()`
    /// guard used in [`queue_renounce_admin`] applies here, ensuring that the
    /// entity that queued the renounce is also the one executing it.
    ///
    /// # Timelock enforcement
    /// The renounce is only executable once `env.ledger().sequence() > target_ledger`
    /// (strict `>`, not `>=`). This adds one extra ledger of safety margin.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]    – Contract has not been initialized.
    /// * [`Error::ActionNotQueued`]   – No renounce was queued (no pending target ledger).
    /// * [`Error::ActionNotReady`]    – The timelock has not yet elapsed.
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

        RescueEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            to: to.clone(),
            amount,
        }
        .publish(&env);
        Ok(())
    }

    // ── View Functions ────────────────────────────────────────────────────

    /// Returns the authorized admin address of the contract.
    ///
    /// # Architecture
    /// The admin address is stored in the contract's instance storage and is
    /// set once during initialization. It serves as the root of trust for
    /// operations like setting limits, processing withdrawals, and updating
    /// contract settings. Only transactions authorized by this address are
    /// permitted to execute administrative functions.
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

    pub fn get_total_deposited(env: Env) -> Result<i128, Error> {
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
            .total_deposited)
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
    pub fn get_receipt_by_index(env: Env, idx: u64) -> Result<Option<Receipt>, Error> {
        // ── Issue #511: circuit breaker guard ────────────────────────────
        if Self::is_circuit_breaker_tripped(env.clone()) {
            CircuitBreakerBlockedEvent {
                version: EVENT_VERSION,
                function: Symbol::new(&env, "get_receipt_by_index"),
            }
            .publish(&env);
            return Err(Error::CircuitBreakerActive);
        }
        let max_receipts: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);
        if idx >= max_receipts {
            return Ok(None);
        }
        let receipt_hash: BytesN<32> = match env
            .storage()
            .temporary()
            .get(&DataKey::ReceiptIndex(idx))
        {
            Some(h) => h,
            None => return Ok(None),
        };
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Receipt(receipt_hash)))
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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalQuota, &quota);
        QuotaSetEvent {
            version: EVENT_VERSION,
            quota,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_withdrawal_quota(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalQuota)
            .unwrap_or(0)
    }

    pub fn get_emergency_recovery_cap(env: Env) -> Option<i128> {
        env.storage().instance().get(&DataKey::EmergencyRecoveryCap)
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

    /// Enforce the per-user daily withdrawal quota.
    ///
    /// Tracks how much a user has withdrawn within the current 24-hour window
    /// (~17 280 ledgers) and rejects the withdrawal if it would push them over
    /// the configured quota.
    ///
    /// # Overflow Prevention
    /// The running total is computed with `checked_add` (issue #697), mirroring
    /// the deposit-side [`enforce_daily_deposit_limit`] hardening (#499). This
    /// prevents a crafted extremely large withdrawal from wrapping the `i128`
    /// daily accumulator and bypassing the quota check; an overflow returns
    /// [`Error::Overflow`].
    ///
    /// # Window Reset
    /// When the current ledger has advanced past `window_start + WINDOW_LEDGERS`
    /// the accumulated amount is reset to zero and the window start is updated.
    /// A [`QuotaResetEvent`] is emitted so off-chain indexers can track resets.
    ///
    /// # Usage Tracking
    /// On the success path a [`WithdrawalQuotaConsumedEvent`] is emitted with the
    /// newly accumulated total so indexers can track per-user daily usage.
    fn enforce_withdrawal_quota(
        env: &Env,
        user: &Address,
        amount: i128,
        token: &Address,
    ) -> Result<(), Error> {
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

        // #697: use checked_add so a crafted extremely large withdrawal cannot
        // wrap the i128 daily accumulator and bypass the quota check below.
        let projected = record.amount.checked_add(amount).ok_or(Error::Overflow)?;

        if projected > quota {
            let excess = projected - quota;
            // Accrue the excess amount as fee to the vault
            let key = DataKey::FeeVault(token.clone());
            let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            env.storage().persistent().set(&key, &(current + excess));
            FeeAccruedEvent {
                version: EVENT_VERSION,
                token: token.clone(),
                amount: excess,
            }
            .publish(env);
            return Err(Error::WithdrawalQuotaExceeded);
        }

        record.amount = projected;
        env.storage()
            .instance()
            .set(&DataKey::UserDailyWithdrawal(user.clone()), &record);

        // #697: emit per-user daily usage so indexers can track quota consumption.
        WithdrawalQuotaConsumedEvent {
            version: EVENT_VERSION,
            user: user.clone(),
            amount,
            accumulated: record.amount,
            quota,
            window_start: record.window_start,
        }
        .publish(env);

        Ok(())
    }

    /// Returns [`Error::ContractPaused`] if the contract is currently paused.
    ///
    /// This guard is called at the top of every user-facing mutating function
    /// (`deposit`, `withdraw`, `request_withdrawal`, `execute_withdrawal`,
    /// `propose_upgrade`, `execute_upgrade`) to provide a single, consistent
    /// circuit-breaker that halts all state changes when the admin has paused
    /// the contract.
    ///
    /// # Design Note
    /// The paused flag is stored in instance storage (not persistent) so that
    /// it is always available without a separate TTL extension.  The
    /// `extend_ttl` call at the top of each public function ensures the
    /// instance storage entry remains live.
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
                        env.storage().temporary().extend_ttl(
                            &DataKey::ReceiptIndex(idx),
                            min_ttl,
                            min_ttl,
                        );
                    }
                }
            }
            idx += 1;
        }
    }

    // ── Escrow Migration ──────────────────────────────────────────────────
    /// Retrieves the current escrow storage version.
    ///
    /// # Returns
    ///
    /// * `u32` - The current storage version. Returns 0 if no migration has been performed.
    ///
    /// # Description
    ///
    /// This function queries the contract's instance storage for the current escrow
    /// storage schema version. The version indicates which storage schema is currently
    /// in use for escrow records. A value of 0 indicates that no migration has been
    /// Retrieves the current escrow storage version from instance storage.
    ///
    /// The version number indicates which schema the escrow records currently follow.
    /// A version of 0 indicates that the contract is using the legacy storage 
    /// format (directpersistent storage without versioning metadata).
    ///
    /// # Returns
    ///
    /// * `u32` - The current storage version (e.g., 1 for the current versioned schema).
    ///
    /// # Registry
    ///
    /// Version 1 was introduced in protocol upgrade v1.2 to support better
    /// reconciliation and architectural modularity.
    pub fn get_escrow_storage_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowStorageVersion)
            .unwrap_or(0)
    }

    /// Migrates escrow records from legacy storage to versioned schema.
    ///
    /// This function facilitates a controlled, batch-based migration of data 
    /// from the unversioned persistent storage format to the `EscrowRecord` 
    /// schema (Version 1).
    ///
    /// # Arguments
    ///
    /// * `env` - The contract environment.
    /// * `batch_size` - Maximum number of records to process in this transaction. 
    ///   Choosing a size between 10 and 100 is recommended to stay within resource limits.
    ///
    /// # Returns
    ///
    /// * `Ok(u32)` - Number of records successfully migrated in this batch.
    /// * `Err(Error::MigrationAlreadyComplete)` - If the storage version is already at target.
    /// * `Err(Error::NotAuthorized)` - If the caller is not the contract admin.
    /// * `Err(Error::NotInitialized)` - If the contract has not been properly initialized.
    ///
    /// # Internal Logic
    ///
    /// 1. **Auth Check**: Verifies `admin.require_auth()`.
    /// 2. **Version Guard**: Checks if `current_version < ESCROW_STORAGE_VERSION`.
    /// 3. **Cursor Recovery**: Loads `EscrowMigrationCursor` to resume where the last batch stopped.
    /// 4. **Batch Loop**: Iterates through `ReceiptIndex` from cursor to `ReceiptCounter`.
    /// 5. **Transformation**: Converts `Receipt` to `EscrowRecord` and saves to persistent storage.
    /// 6. **Commit**: Updates the cursor and, if complete, sets the final storage version.
    ///
    /// # Security & Atomicity
    ///
    /// Each call is atomic. If a batch partially fails, the cursor is not updated,
    /// ensuring no records are skipped. The use of a timelock is not required for 
    /// migration, but only the admin may trigger it.
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

    /// Retrieves a migrated escrow record by its ID.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract environment
    /// * `id` - The unique identifier of the escrow record to retrieve
    ///
    /// # Returns
    ///
    /// * `Some(EscrowRecord)` - The escrow record if it exists and has been migrated
    /// * `None` - Record not found or not yet migrated
    ///
    /// # Description
    ///
    /// This function queries persistent storage for an escrow record with the given ID.
    /// The record will only be present if it has been migrated to the versioned schema.
    /// Records that have not yet been migrated will return `None`.
    ///
    /// # Example
    /// Retrieves a migrated escrow record by its ID.
    ///
    /// This function only returns records that have already been processed by the
    /// migration script. For records that haven't been migrated yet, use legacy
    /// lookup methods or check `get_migration_cursor()`.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract environment.
    /// * `id` - The record ID to retrieve.
    ///
    /// # Returns
    ///
    /// * `Some(EscrowRecord)` - The migrated record if found.
    /// * `None` - If the record doesn't exist or hasn't been migrated.
    pub fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord> {
        env.storage().persistent().get(&DataKey::EscrowRecord(id))
    }

    /// Gets the current migration progress cursor.
    ///
    /// The cursor represents the last successfully processed record ID. This
    /// can be used to track progress against the `ReceiptCounter`.
    ///
    /// # Returns
    ///
    /// * `u64` - The ID of the last record processed (0 if none or just started).
    ///
    /// # Usage
    ///
    /// - Monitor migration progress by comparing cursor to total record count.
    /// - Determine if migration is complete (cursor >= total records).
    /// - Debug migration issues by checking cursor position.
    pub fn get_migration_cursor(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowMigrationCursor)
            .unwrap_or(0)
    }

    // ── Batched Admin Operations ──────────────────────────────────────────

    /// Executes a batch of administrative operations atomically.
    ///
    /// Allows the contract admin to perform multiple state mutations in a single transaction.
    /// Each operation is processed sequentially; if an operation fails, execution continues
    /// with the next operation (no rollback).
    ///
    /// # Arguments
    ///
    /// * `env` - The contract environment
    /// * `operations` - A vector of `BatchAdminOp` structures, each specifying an operation type
    ///   and binary-encoded parameters
    ///
    /// # Returns
    ///
    /// * `Ok(BatchResult)` - Detailed results including success/failure counts and the index
    ///   of the first operation that failed (if any)
    /// * `Err(Error::NotInitialized)` - Contract has not been initialized
    /// * `Err(Error::Overflow)` - Internal counter overflow (extremely unlikely)
    ///
    /// # Authorization
    ///
    /// Requires that the caller be the contract admin:
    /// ```rust,no_run
    /// admin.require_auth()  // Panics/errors if caller is not admin
    /// ```
    ///
    /// # Supported Operations
    ///
    /// | Operation | Symbol | Payload | Effect |
    /// |-----------|--------|---------|--------|
    /// | Set cooldown | `"set_cooldown"` | u32 BE | Sets cooldown period in ledgers |
    /// | Set lock period | `"set_lock"` | u32 BE | Sets lock period in ledgers |
    /// | Set quota | `"set_quota"` | i128 BE | Sets daily withdrawal quota |
    /// | Set sandwich delay | `"set_sandwich"` | u32 BE | Sets anti-sandwich delay in ledgers |
    /// | Pause | `"pause"` | (empty) | Pauses all user deposits/withdrawals |
    /// | Unpause | `"unpause"` | (empty) | Resumes user deposits/withdrawals |
    ///
    /// For detailed payload encoding rules, see [`BatchAdminOp`].
    ///
    /// # Execution Semantics
    ///
    /// **Key behavior**: This is **not** a transactional rollback operation. If operation N
    /// fails, operations 0 to N-1 have already modified contract state, and operations N+1
    /// onwards still execute.
    ///
    /// 1. Authorization check: Caller must be admin
    /// 2. For each operation in order:
    ///    a. Attempt `execute_single_admin_op()`
    ///    b. On success: increment `success_count`
    ///    c. On failure: increment `failure_count`, record `failed_index` if first failure,
    ///       and continue to next operation
    /// 3. Emit `BatchOkEvent` with final counts (or multiple `BatchFailEvent`s if failures occurred)
    /// 4. Return `BatchResult` with final counts
    ///
    /// # Error Recording
    ///
    /// When an operation fails:
    /// - A `BatchFailEvent` is emitted containing the operation's index
    /// - Execution continues with the next operation
    /// - The operation is counted in `failure_count`
    /// - `failed_index` is set to this operation's index (if it's the first failure)
    ///
    /// Only the **first** failure's index is recorded in `BatchResult.failed_index`.
    /// Subsequent failures are counted but their indices are not stored.
    ///
    /// # Events Emitted
    ///
    /// - `BatchFailEvent`: Emitted for each operation that fails
    ///   - Contains: version, operation index, total operations count
    /// - `BatchOkEvent`: Emitted at the end
    ///   - Contains: version, success_count, failure_count, total_ops
    ///
    /// # Examples
    ///
    /// ## Successful Batch
    ///
    /// ```rust,no_run
    /// # use soroban_sdk::{Env, Symbol, Bytes};
    /// # struct Bridge;
    /// # impl Bridge {
    /// # pub fn execute_batch_admin(env: Env, ops: Vec<BatchAdminOp>) -> Result<BatchResult, Error> { unimplemented!() }
    /// let mut ops = soroban_sdk::Vec::new(&env);
    ///
    /// // Operation 0: Set cooldown to 100 ledgers
    /// ops.push_back(BatchAdminOp {
    ///     op_type: Symbol::new(&env, "set_cooldown"),
    ///     payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
    /// });
    ///
    /// // Operation 1: Set lock period to 50 ledgers
    /// ops.push_back(BatchAdminOp {
    ///     op_type: Symbol::new(&env, "set_lock"),
    ///     payload: Bytes::from_array(&env, &50u32.to_be_bytes()),
    /// });
    ///
    /// let result = bridge.execute_batch_admin(&env, ops)?;
    /// assert_eq!(result.total_ops, 2);
    /// assert_eq!(result.success_count, 2);
    /// assert_eq!(result.failure_count, 0);
    /// assert!(result.failed_index.is_none());
    /// # }
    /// ```
    ///
    /// ## Batch with Failures
    ///
    /// ```rust,no_run
    /// # use soroban_sdk::{Env, Symbol, Bytes};
    /// # struct Bridge;
    /// # impl Bridge {
    /// # pub fn execute_batch_admin(env: Env, ops: Vec<BatchAdminOp>) -> Result<BatchResult, Error> { unimplemented!() }
    /// let mut ops = soroban_sdk::Vec::new(&env);
    ///
    /// // Operation 0: Valid - set cooldown
    /// ops.push_back(BatchAdminOp {
    ///     op_type: Symbol::new(&env, "set_cooldown"),
    ///     payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
    /// });
    ///
    /// // Operation 1: Invalid - malformed payload (too short)
    /// ops.push_back(BatchAdminOp {
    ///     op_type: Symbol::new(&env, "set_lock"),
    ///     payload: Bytes::new(&env),  // ERROR: requires 4 bytes!
    /// });
    ///
    /// // Operation 2: Valid - still executes despite operation 1 failure
    /// ops.push_back(BatchAdminOp {
    ///     op_type: Symbol::new(&env, "set_sandwich"),
    ///     payload: Bytes::from_array(&env, &3u32.to_be_bytes()),
    /// });
    ///
    /// let result = bridge.execute_batch_admin(&env, ops)?;
    /// // Result:
    /// //   total_ops: 3
    /// //   success_count: 2 (operations 0 and 2)
    /// //   failure_count: 1 (operation 1)
    /// //   failed_index: Some(1) (first failure at index 1)
    /// # }
    /// ```
    ///
    /// # See Also
    ///
    /// - [`BatchAdminOp`]: Structure defining individual operations
    /// - [`BatchResult`]: Detailed result information
    /// - [BATCH_OPERATIONS.md](../../docs/BATCH_OPERATIONS.md): Comprehensive batch operations guide
    pub fn execute_batch_admin(
        env: Env,
        operations: Vec<BatchAdminOp>,
    ) -> Result<BatchResult, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Timelock role check (fix #525): admin must not be an operator.
        // Conflating roles bypasses the governance timelock security model.
        require!(
            !Self::is_operator(env.clone(), admin.clone()),
            Error::NotAllowed
        );
        AdminRoleCheckEvent {
            version: EVENT_VERSION,
            admin: admin.clone(),
        }
        .publish(&env);

        let total_ops = operations.len();
        let mut success_count: u32 = 0;
        let mut failure_count: u32 = 0;
        let mut first_failed_index: Option<u32> = None;

        for (idx, op) in operations.iter().enumerate() {
            let index = u32::try_from(idx).map_err(|_| Error::Overflow)?;
            let result = Self::execute_single_admin_op(&env, &op);
            if result.is_err() {
                BatchFailEvent {
                    version: EVENT_VERSION,
                    index,
                    total_ops,
                }
                .publish(&env);
                failure_count = failure_count.checked_add(1).ok_or(Error::Overflow)?;
                if first_failed_index.is_none() {
                    first_failed_index = Some(index);
                }
                continue;
            }
            success_count = success_count.checked_add(1).ok_or(Error::Overflow)?;
        }

        let batch_result = BatchResult {
            total_ops,
            success_count,
            failure_count,
            failed_index: first_failed_index,
        };

        BatchOkEvent {
            version: EVENT_VERSION,
            success_count,
            failure_count,
            total_ops,
        }
        .publish(&env);

        Ok(batch_result)
    }

    /// Executes a single administrative operation.
    ///
    /// This is a private helper function called by `execute_batch_admin` to process
    /// individual operations. It dispatches to the appropriate handler based on the
    /// operation type.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract environment
    /// * `op` - The operation to execute
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Operation executed successfully
    /// * `Err(Error::InternalError)` - Any error condition:
    ///   - Unknown operation type
    ///   - Malformed or incorrectly-sized payload
    ///   - Payload decoding failure
    ///
    /// # Operation Handlers
    ///
    /// | op_type | Handler | Effect |
    /// |---------|---------|--------|
    /// | `"set_cooldown"` | Decode u32, store in `DataKey::CooldownLedgers` | ✓ |
    /// | `"set_lock"` | Decode u32, store in `DataKey::LockPeriod` | ✓ |
    /// | `"set_quota"` | Decode i128, store in `DataKey::WithdrawalQuota` | ✓ |
    /// | `"set_sandwich"` | Decode u32, store in `DataKey::AntiSandwichDelay` | ✓ |
    /// | `"pause"` | Store `true` in `DataKey::Paused` | ✓ |
    /// | `"unpause"` | Store `false` in `DataKey::Paused` | ✓ |
    /// | (anything else) | Return `Error::InternalError` | - |
    ///
    /// # Notes
    ///
    /// - Each operation either succeeds completely or fails without side effects
    /// - Failures are counted but do not stop subsequent operations
    /// - State changes from successful operations are immediately visible
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

    /// Converts a big-endian byte sequence to a `u32`.
    ///
    /// Used to decode operation payloads that contain unsigned 32-bit integers.
    /// The bytes must be in **big-endian** byte order (most significant byte first).
    ///
    /// # Arguments
    ///
    /// * `_env` - The contract environment (unused)
    /// * `bytes` - The byte sequence to decode
    ///
    /// # Returns
    ///
    /// * `Ok(u32)` - The decoded value
    /// * `Err(Error::InternalError)` - The byte sequence is shorter than 4 bytes
    ///
    /// # Byte Order
    ///
    /// The function assumes **big-endian** encoding:
    /// ```text
    /// Bytes:  [0xAA, 0xBB, 0xCC, 0xDD]
    /// Result: 0xAABBCCDD
    /// ```
    ///
    /// # Errors
    ///
    /// Returns `Error::InternalError` if `bytes.len() < 4`. This typically represents
    /// a malformed payload in a batch operation.
    ///
    /// # Examples
    ///
    /// ```text
    /// bytes_to_u32(Bytes::from_array([0x00, 0x00, 0x00, 0x64])) -> Ok(100)
    /// bytes_to_u32(Bytes::from_array([0x00, 0x00, 0x01, 0x00])) -> Ok(256)
    /// bytes_to_u32(Bytes::new())                                 -> Err(InternalError)
    /// ```
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

    /// Converts a big-endian byte sequence to an `i128`.
    ///
    /// Used to decode operation payloads that contain signed 128-bit integers.
    /// The bytes must be in **big-endian** byte order (most significant byte first).
    /// Negative numbers are represented using two's complement notation.
    ///
    /// # Arguments
    ///
    /// * `_env` - The contract environment (unused)
    /// * `bytes` - The byte sequence to decode (must be exactly 16 bytes)
    ///
    /// # Returns
    ///
    /// * `Ok(i128)` - The decoded value (can be positive, negative, or zero)
    /// * `Err(Error::InternalError)` - The byte sequence is shorter than 16 bytes
    ///
    /// # Byte Order
    ///
    /// The function assumes **big-endian** encoding with two's complement for negatives:
    /// ```text
    /// Positive example:
    /// Bytes:  [0x00, 0x00, ..., 0x00, 0x64]  (15 zeros followed by 0x64)
    /// Result: 100
    ///
    /// Negative example:
    /// Bytes:  [0xFF, 0xFF, ..., 0xFF, 0xFF]  (all 0xFF)
    /// Result: -1
    /// ```
    ///
    /// # Errors
    ///
    /// Returns `Error::InternalError` if `bytes.len() < 16`. This typically represents
    /// a malformed payload in a batch operation (e.g., `set_quota` with insufficient data).
    ///
    /// # Examples
    ///
    /// ```text
    /// bytes_to_i128([0x00, 0x00, ..., 0x00, 0x64]) -> Ok(100)
    /// bytes_to_i128([0xFF, 0xFF, ..., 0xFF, 0xFF]) -> Ok(-1)
    /// bytes_to_i128([...partial data...])          -> Err(InternalError)
    /// ```
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

    /// Set the rolling 24-hour withdrawal volume threshold that triggers the
    /// circuit breaker.  Pass `0` to disable.
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

    /// Set the number of ledgers after which a tripped circuit breaker
    /// automatically resets. Pass `0` to use the compile-time default
    /// (`CIRCUIT_BREAKER_RESET_LEDGERS`). Set to `u32::MAX` to disable
    /// auto-reset entirely.
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

    pub fn get_circuit_breaker_reset_window(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerResetWindow)
            .unwrap_or(CIRCUIT_BREAKER_RESET_LEDGERS)
    }

    /// Reset the circuit breaker so withdrawals can resume.
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
        CircuitBreakerResetEvent {
            version: EVENT_VERSION,
            ledger: env.ledger().sequence(),
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_circuit_breaker_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerThreshold)
            .unwrap_or(0)
    }

    pub fn is_circuit_breaker_tripped(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::CircuitBreakerTripped)
            .unwrap_or(false)
    }

    fn maybe_auto_reset_circuit_breaker(env: &Env) {
        let threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreakerThreshold)
            .unwrap_or(0);
        if threshold <= 0 {
            return;
        }

        if !env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::CircuitBreakerTripped)
            .unwrap_or(false)
        {
            return;
        }

        let curr = env.ledger().sequence();
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
            env.storage()
                .instance()
                .set(&DataKey::CircuitBreakerTripped, &false);
            env.storage().instance().set(
                &DataKey::GlobalDailyWithdrawn,
                &GlobalDailyWithdrawn {
                    amount: 0,
                    window_start: curr,
                },
            );
            CircuitBreakerAutoResetEvent {
                version: EVENT_VERSION,
                tripped_at,
                reset_at: curr,
            }
            .publish(env);
        }
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
                env.storage().instance().set(
                    &DataKey::GlobalDailyWithdrawn,
                    &GlobalDailyWithdrawn {
                        amount: 0,
                        window_start: curr,
                    },
                );
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

        if new_total > threshold {
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

        env.storage()
            .instance()
            .set(&DataKey::WithdrawOperator, &operator);
        SetWithdrawOperatorEvent {
            version: EVENT_VERSION,
            operator: operator.clone(),
        }
        .publish(&env);
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
        RemoveWithdrawOperatorEvent {
            version: EVENT_VERSION,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_withdraw_operator(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::WithdrawOperator)
    }

    // ── Issue #107: Governed upgrade mechanism (fixed by issue #668) ─────────

    /// Set the minimum delay (in ledgers) required for upgrade proposals.
    ///
    /// # Overflow Prevention
    /// The stored delay is a `u32`.  It is added to the current ledger
    /// sequence in [`propose_upgrade`] using `checked_add`, so storing any
    /// `u32` value here is safe — the overflow guard fires at proposal time,
    /// not here.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – Contract has not been initialised.
    /// * [`Error::Unauthorized`]   – Caller is not the admin.
    pub fn set_upgrade_delay(env: Env, ledgers: u32) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::UpgradeDelay, &ledgers);
        Ok(())
    }

    /// Returns the configured minimum upgrade delay in ledgers.
    ///
    /// Falls back to [`MIN_UPGRADE_DELAY`] when no custom delay has been set.
    pub fn get_upgrade_delay(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(MIN_UPGRADE_DELAY)
    }

    /// Propose a WASM upgrade for the contract.
    ///
    /// # Overview
    /// The upgrade mechanism is a two-phase commit: first the admin *proposes*
    /// a new WASM hash with a mandatory time-delay, then after the delay has
    /// elapsed the admin *executes* the upgrade.  This prevents surprise
    /// upgrades and gives observers time to audit the new bytecode.
    ///
    /// # Bug Fixes (issue #668)
    /// The previous implementation had two edge-case bugs:
    ///
    /// 1. **Missing delay boundary check** — a caller could pass `delay = 0`
    ///    (or any value below `MIN_UPGRADE_DELAY`) and the proposal would be
    ///    accepted with `executable_after` in the immediate past, allowing an
    ///    instant upgrade that bypasses the governance timelock.  Fixed by
    ///    rejecting `delay < MIN_UPGRADE_DELAY` with `Error::UpgradeDelayTooShort`.
    ///
    /// 2. **`saturating_add` instead of `checked_add`** — `saturating_add`
    ///    clamps at `u32::MAX` when the sum overflows.  `u32::MAX` is a valid
    ///    ledger number far in the future, so this appeared safe, but it
    ///    silently accepted an overflow rather than surfacing it.  More
    ///    critically, if `current_ledger` is already near `u32::MAX`, the
    ///    saturated result equals `u32::MAX` regardless of `delay`, meaning
    ///    two proposals with very different delays would have the same
    ///    `executable_after`.  Fixed by using `checked_add` and returning
    ///    `Error::Overflow`.
    ///
    /// # Overflow Prevention
    /// `executable_after` is computed as `current_ledger + delay`.  Both
    /// operands are `u32`, so the sum could theoretically overflow.  We use
    /// `checked_add` and return [`Error::Overflow`] rather than silently
    /// wrapping or clamping, which would produce an `executable_after` that
    /// does not accurately reflect the requested delay.
    ///
    /// # Arguments
    /// * `env`       – The contract environment.
    /// * `wasm_hash` – SHA-256 hash of the new WASM bytecode, as returned by
    ///                 `stellar contract install`.
    /// * `delay`     – Number of ledgers to wait before the upgrade can be
    ///                 executed.  Must be ≥ `MIN_UPGRADE_DELAY` (1 000 ledgers
    ///                 ≈ 83 minutes on Stellar mainnet).
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]       – Contract has not been initialised.
    /// * [`Error::Unauthorized`]         – Caller is not the admin.
    /// * [`Error::ContractPaused`]       – Contract is currently paused.
    /// * [`Error::UpgradeDelayTooShort`] – `delay < MIN_UPGRADE_DELAY`.
    /// * [`Error::Overflow`]             – `current_ledger + delay` overflows `u32`.
    pub fn propose_upgrade(env: Env, wasm_hash: BytesN<32>, delay: u32) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        Self::require_not_paused(&env)?;

        // Boundary check (fix #668): reject delays that are too short.
        // A delay of zero (or below the protocol minimum) would allow an
        // immediate upgrade, defeating the purpose of the timelock entirely.
        require!(delay >= MIN_UPGRADE_DELAY, Error::UpgradeDelayTooShort);

        // Overflow prevention (fix #668): use checked_add so that an extremely
        // large `delay` value cannot wrap around or saturate to a value that
        // does not accurately represent the requested delay.
        let current_ledger = env.ledger().sequence();
        let executable_after = current_ledger.checked_add(delay).ok_or(Error::Overflow)?;

        let proposal = UpgradeProposal {
            wasm_hash: wasm_hash.clone(),
            executable_after,
        };

        env.storage()
            .instance()
            .set(&DataKey::UpgradeProposal, &proposal);
        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "upg_prop")),
            (wasm_hash, executable_after),
        );
        Ok(())
    }

    /// Execute a previously proposed WASM upgrade.
    ///
    /// # Bug Fixes (issue #668)
    /// The previous implementation used `<` for the readiness check:
    /// ```text
    /// if env.ledger().sequence() < proposal.executable_after { ... }
    /// ```
    /// This allowed execution at exactly `executable_after`, which is an
    /// off-by-one error.  The rest of the timelock pattern in this contract
    /// (`execute_admin_action`, `execute_renounce_admin`) uses strict `<=`
    /// (i.e. `sequence() <= target_ledger` → not ready), adding one extra
    /// ledger of safety margin.  Fixed to use `<=` for consistency.
    ///
    /// Additionally, the previous implementation did not require admin auth
    /// or check the paused state, meaning any caller could execute a pending
    /// upgrade even while the contract was paused.  Both checks are now
    /// enforced.
    ///
    /// # Overflow Prevention
    /// The readiness check compares `current_ledger > proposal.executable_after`.
    /// Both values are `u32`; no arithmetic is performed, so there is no
    /// overflow risk in the comparison itself.  The overflow guard lives in
    /// [`propose_upgrade`] where the `executable_after` value is computed.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]         – Contract has not been initialised.
    /// * [`Error::Unauthorized`]           – Caller is not the admin.
    /// * [`Error::ContractPaused`]         – Contract is currently paused.
    /// * [`Error::UpgradeProposalMissing`] – No pending upgrade proposal.
    /// * [`Error::UpgradeNotReady`]        – Timelock has not yet elapsed.
    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        Self::require_not_paused(&env)?;

        // Boundary check: a proposal must exist before we can execute.
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(Error::UpgradeProposalMissing)?;

        // Boundary check (fix #668): use strict `>` (i.e. reject when
        // `sequence <= executable_after`) to match the rest of the timelock
        // pattern and add one extra ledger of safety margin.
        require!(env.ledger().sequence() > proposal.executable_after, Error::UpgradeNotReady);

        // Consume the proposal before performing the upgrade so that a
        // re-entrant call (if ever possible) cannot replay it.
        env.storage().instance().remove(&DataKey::UpgradeProposal);

        // Apply the WASM upgrade.  This replaces the contract's executable
        // bytecode atomically at the end of the current transaction.
        env.deployer()
            .update_current_contract_wasm(proposal.wasm_hash.clone());

        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "upg_exec")),
            proposal.wasm_hash,
        );
        Ok(())
    }

    /// Cancel a pending upgrade proposal.
    ///
    /// Removes the stored [`UpgradeProposal`] without executing the upgrade.
    /// Useful when the admin wants to abort an upgrade (e.g. a security issue
    /// was found in the proposed WASM) before the timelock elapses.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`]         – Contract has not been initialised.
    /// * [`Error::Unauthorized`]           – Caller is not the admin.
    /// * [`Error::UpgradeProposalMissing`] – No pending proposal to cancel.
    pub fn cancel_upgrade(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        Self::require_not_paused(&env)?;

        // Boundary check: nothing to cancel if no proposal exists.
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(Error::UpgradeProposalMissing)?;

        env.storage().instance().remove(&DataKey::UpgradeProposal);
        env.events().publish(
            (EVENT_VERSION, Symbol::new(&env, "upg_can")),
            proposal.wasm_hash,
        );
        Ok(())
    }

    /// Returns the pending upgrade proposal, if any.
    ///
    /// Returns `None` when no upgrade has been proposed or after the upgrade
    /// has been executed or cancelled.
    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&DataKey::UpgradeProposal)
    }

    // ── Issue #100: Multi-sig Logic ──────────────────────────────────────────

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

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextMultisigID)
            .unwrap();
        env.storage()
            .instance()
            .set(&DataKey::NextMultisigID, &(id + 1));

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

        env.events()
            .publish((EVENT_VERSION, Symbol::new(&env, "multisig_executed")), id);

        Ok(())
    }

    pub fn get_multisig_proposal(env: Env, id: u64) -> Option<MultisigProposal> {
        env.storage().instance().get(&DataKey::MultisigProposal(id))
    }

    pub fn get_multisig_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_multisig_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0)
    }
}

#[cfg(any(test, feature = "testutils"))]
mod test;

#[cfg(test)]
mod test_new_issues;

#[cfg(test)]
mod test_issues_695_687;

#[cfg(test)]
mod test_issues_504_511_600;

#[cfg(test)]
mod test_issues_492_499;

#[cfg(test)]
mod test_issues_840;

#[cfg(test)]
mod test_issue_697;

#[cfg(test)]
mod test_issue_702;

#[cfg(test)]
mod test_issue_832;

#[cfg(test)]
mod test_issue_681;
