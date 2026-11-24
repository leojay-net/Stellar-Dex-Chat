#![no_std]
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]
#![cfg_attr(
    test,
    allow(
        unused_variables,
        unused_imports,
        dead_code,
        mismatched_lifetime_syntaxes,
        clippy::duplicated_attributes
    )
)]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token,
    xdr::{FromXdr, ToXdr},
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
/// Maximum lock period to prevent overflow in unlock_ledger calculation.
/// Set to 1 year of ledgers (~6.3M at ~5-6 seconds per ledger).
const MAX_LOCK_PERIOD: u32 = 6_307_200;
/// Number of ledgers a multisig proposal is valid before it expires.
/// Stellar closes roughly 1 ledger every ~5–6 seconds (≈17 280 ledgers/day).
/// At that rate 518 400 ledgers ≈ 30 days.
const MULTISIG_PROPOSAL_EXPIRY: u32 = 518_400; // ~30 days
/// Number of ledgers an operator may go without a heartbeat before being
/// eligible for pruning by `prune_inactive_operators`.
///
/// Stellar closes roughly 1 ledger every ~5–6 seconds (≈17 280 ledgers/day).
/// At that rate 1 555 200 ledgers ≈ 90 days (3 months).  The value is stored
/// per-deployment in `DataKey::InactivityThreshold` so it can be changed via
/// governance; this constant is the on-chain default used when no override has
/// been written.
const DEFAULT_INACTIVITY_THRESHOLD: u32 = 1_555_200; // ~3 months (≈17 280 ledgers/day)
pub const MIN_INACTIVITY_THRESHOLD: u32 = 1;
pub const MAX_INACTIVITY_THRESHOLD: u32 = 10_000_000;
const MIN_UPGRADE_DELAY: u32 = 1_000;
pub const EVENT_VERSION: u32 = 1;
pub const ESCROW_STORAGE_VERSION: u32 = 1;
/// Schema version of [`ConfigSnapshot`]. v2 removed `allowlist_enabled`
/// (Issue #1401).
pub const CONFIG_SNAPSHOT_VERSION: u32 = 2;

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
    OperatorCapReached = 206,
    SameAdmin = 207,

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
    /// Deprecated: the active circuit breaker error is `CircuitBreakerActive`.
    #[deprecated(note = "use CircuitBreakerActive instead")]
    CircuitBreakerTripped = 315,
    MaxDeniedReached = 316,
    InvalidAmount = 317,
    SelfReferentialAddress = 318,
    LimitCapCannotBeLowered = 319,
    /// Returned by [`FiatBridge::register_token`] when the token already has a
    /// registry entry (including the primary token registered by `init`).
    TokenAlreadyRegistered = 320,

    // --- 400 series: Funds & Balances ---
    InsufficientFunds = 401,
    NoFeesToWithdraw = 402,

    // --- 500 series: Withdrawal Queue ---
    RequestNotFound = 501,
    WithdrawalLocked = 502,
    /// Returned by [`FiatBridge::withdraw`] when the withdraw operator's rolling
    /// 24h volume would exceed its [`FiatBridge::set_operator_daily_limit`] cap.
    OperatorDailyLimitExceeded = 503,

    // --- 600 series: Governance & Timelock ---
    ActionNotQueued = 601,
    ActionNotReady = 602,
    InactivityThresholdNotReached = 603,
    NoEmergencyRecoveryAddress = 604,
    UpgradeNotReady = 605,
    UpgradeProposalMissing = 606,
    UpgradeDelayTooShort = 607,
    /// Returned by [`FiatBridge::propose_upgrade`] when `new_version` is
    /// strictly less than the currently stored contract version, preventing
    /// accidental rollbacks to an older schema.
    DowngradeNotAllowed = 608,

    // --- 700 series: External Services ---
    OracleNotSet = 701,
    OraclePriceInvalid = 702,
    /// Deprecated: use `SlippageTooHigh`; no contract path returns this error.
    #[deprecated(note = "use SlippageTooHigh instead")]
    SlippageExceeded = 703,
    SlippageTooHigh = 704,

    // --- 800 series: Quota & Migration ---
    WithdrawalQuotaExceeded = 801,
    MigrationAlreadyComplete = 802,
    /// Deprecated: no contract path returns this error.
    #[deprecated(note = "unused error code; do not use")]
    BatchOperationFailed = 803,

    // --- 900 series: Replay Protection ---
    InvalidNonce = 901,
    StaleNonce = 902,

    // --- 1000 series: Deposit Floor ---
    BelowMinimum = 1001,

    // --- 1100 series: Deposit Rate Limit ---
    /// Deposit rate limit per block exceeded (Issue #1382: formally dropped feature).
    #[deprecated(note = "deposit rate limit feature dropped; this error is never returned")]
    DepositRateLimitExceeded = 1100,

    // --- 1200 series: Multi-sig ---
    InvalidThreshold = 1201,
    DuplicateSigner = 1202,
    SignerNotFound = 1203,
    ProposalNotFound = 1204,
    AlreadyApproved = 1205,
    ProposalAlreadyExecuted = 1206,
    ThresholdNotMet = 1207,
    MaxSignersReached = 1208,
    ProposalExpired = 1209,
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
    pub token: Address,
    pub amount: i128,
    pub ledger: u32,
    pub reference: Bytes,
    pub memo_hash: Option<BytesN<32>>,
}

/// Legacy receipt schema prior to token field addition, retained for backward compatibility.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptV1 {
    pub id: BytesN<32>,
    pub depositor: Address,
    pub amount: i128,
    pub ledger: u32,
    pub reference: Bytes,
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
    /// The contract version that will become current once this proposal is
    /// executed.  Stored here so [`FiatBridge::execute_upgrade`] can bump
    /// [`DataKey::ContractVersion`] atomically with the WASM swap.
    pub new_version: u32,
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
pub struct UpdateMultisigArgs {
    pub threshold: u32,
    pub signers: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetLimitArgs {
    pub token: Address,
    pub limit: i128,
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
    /// Schema version of this snapshot. Bump whenever a field is added,
    /// removed, or changes meaning, so clients can detect a stale ABI
    /// assumption instead of silently misreading a shifted field.
    pub version: u32,
    pub admin: Address,
    pub pending_admin: Option<Address>,
    pub token: Address,
    pub oracle: Option<Address>,
    pub fiat_limit: Option<i128>,
    pub lock_period: u32,
    pub cooldown_ledgers: u32,
    pub inactivity_threshold: u32,
    pub emergency_recovery: Option<Address>,
    pub anti_sandwich_delay: u32,
    pub paused: bool,
    pub min_deposit: i128,
    pub fee_recipient: Option<Address>,
    pub withdraw_operator: Option<Address>,
    pub withdrawal_quota: i128,
    pub withdrawal_cooldown_ledgers: u32,
    pub withdrawal_cooldown_threshold: i128,
    pub withdrawal_expiry_window: u32,
    pub slippage_threshold: u32,
    pub upgrade_delay: u32,
    pub circuit_breaker_threshold: i128,
    pub circuit_breaker_reset_window: u32,
    pub multisig_threshold: u32,
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
    /// Caller who authorised the deposit (issue #971: same as `from` here,
    /// since deposits are always self-authorised, but named explicitly so
    /// indexers can treat every state-changing event uniformly).
    pub by: Address,
    /// Ledger sequence (block height) at which the deposit was recorded (#971).
    pub ledger: u32,
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
pub struct ReceiptIndexOutOfBoundsEvent {
    pub version: u32,
    pub index: u64,
    pub receipt_count: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct WithdrawEvent {
    pub version: u32,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    /// Caller who authorised the withdrawal — the admin or the configured
    /// withdraw operator, never necessarily `to` (#971).
    pub by: Address,
    /// Ledger sequence (block height) at which the withdrawal was executed (#971).
    pub ledger: u32,
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
pub struct FeeRecipientSetEvent {
    pub version: u32,
    pub old_recipient: Option<Address>,
    pub new_recipient: Option<Address>,
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
pub struct SetLockPeriodEvent {
    pub version: u32,
    pub old: u32,
    pub new: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct TokenRegisteredEvent {
    pub version: u32,
    pub token: Address,
    pub limit: i128,
    pub daily_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OperatorDailyLimitSetEvent {
    pub version: u32,
    pub operator: Address,
    pub limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SetLimitEvent {
    pub version: u32,
    pub token: Address,
    pub limit: i128,
    /// Admin who changed the limit (#971).
    pub by: Address,
    /// Ledger sequence (block height) at which the limit was changed (#971).
    pub ledger: u32,
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
    /// Admin who changed the operator's status (#971).
    pub by: Address,
    /// Ledger sequence (block height) at which the change took effect (#971).
    pub ledger: u32,
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
pub struct IsDeniedCheckedEvent {
    pub version: u32,
    pub address: Address,
    pub is_denied: bool,
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

/// Emitted by every nonce site that routes through [`FiatBridge::consume_nonce`].
/// `scope` names which nonce family was consumed (e.g. `"operator"`,
/// `"set_limit"`, `"init"`, `"fee_withdrawal"`, `"withdrawal_execution"`,
/// `"upgrade_cancel"`), and `owner` is the address the nonce is keyed on.
/// This single event shape replaces the several near-identical,
/// inconsistently-emitted nonce events that used to be scattered across the
/// individual nonce sites.
#[contractevent]
#[derive(Clone, Debug)]
pub struct NonceConsumedEvent {
    pub version: u32,
    pub scope: Symbol,
    pub owner: Address,
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
    pub token: Address,
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
pub struct UpgradeCancelledEvent {
    pub version: u32,
    pub admin: Address,
    pub wasm_hash: BytesN<32>,
    pub nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct UpgradeProposedEvent {
    pub version: u32,
    pub wasm_hash: BytesN<32>,
    pub executable_after: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct UpgradeExecutedEvent {
    pub version: u32,
    pub wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigProposedEvent {
    pub version: u32,
    pub id: u64,
    pub proposer: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigApprovedEvent {
    pub version: u32,
    pub id: u64,
    pub signer: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigRevokedEvent {
    pub version: u32,
    pub id: u64,
    pub signer: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct MultisigExecutedEvent {
    pub version: u32,
    pub id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigUpdatedEvent {
    pub version: u32,
    pub signers: Vec<Address>,
    pub threshold: u32,
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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyRecoveryEvent {
    pub version: u32,
    pub recovery: Address,
    pub amount: i128,
    pub admin_last_active: u32,
    pub triggered_at: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InactivityThresholdSetEvent {
    pub version: u32,
    pub admin: Address,
    pub old_threshold: u32,
    pub new_threshold: u32,
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
    /// Per-user, per-token available balance (deposited minus reserved withdrawals).
    /// This tracks the actual funds available for withdrawal requests, unlike
    /// UserDeposited which is a lifetime total across all tokens.
    ///
    /// STORAGE MIGRATION NOTE:
    /// When upgrading from a version without this key, existing UserDeposited values
    /// represent lifetime totals across all tokens and cannot be directly migrated to
    /// per-token available balances. A migration script should:
    /// 1. Read all existing UserDeposited(user) values
    /// 2. For each user, determine their actual available balance per token by
    ///    checking TokenRegistry.total_deposited minus their executed withdrawals
    /// 3. Write UserAvailableBalance(user, token) for each token they have deposits in
    /// 4. Alternatively, treat existing deposits as fully available and set
    ///    UserAvailableBalance to the UserDeposited value for the default token only
    UserAvailableBalance(Address, Address),
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
    /// Slot in `TokenAllowlistEnabledIndex` holding this token's entry, so a
    /// toggle updates the entry in place instead of appending (Issue #1406).
    TokenAllowlistEnabledSlot(Address),
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
    OperatorActivatedAt(Address),
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
    // ── Issue #1003: contract version migration guard ────────────────────
    /// Monotonically increasing contract version.  Written to `0` on first
    /// `init` and bumped to `new_version` by every successful
    /// `execute_upgrade`.
    ContractVersion,
    // ── Issue #100: M-of-N multi-signature admin control ─────────────────
    Signers,
    Threshold,
    MultisigProposal(u64),
    NextMultisigID,
    // ── Issue #496: slippage threshold for batch operations ─────────────
    SlippageThreshold,
    // ── Issue #1044: fee recipient address ───────────────────────────
    FeeRecipient,
    OperatorDailyLimit(Address),
    OperatorDailyVolume(Address),
    SetOperatorNonce(Address),
    SetLimitNonce(Address),
    InitNonce(Address),
    FeeWithdrawalNonceByCaller(Address),
    LimitMaxCap,
    UpgradeCancellationNonce(Address),
    EmergencyRecoveryCap,
    WithdrawalExecutionNonce(Address),
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
        TelemetryEvent {
            version: EVENT_VERSION,
            function_name,
        }
        .publish(env);
    }

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

        if env.storage().instance().has(&DataKey::Admin) {
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
        let reg_key = DataKey::TokenRegistry(token.clone());
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

        env.storage().instance().set(&DataKey::SchemaVersion, &1u32);
        // ── Issue #1003: initialise contract version to 0 ────────────────
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &0u32);
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

        Self::validate_and_increment_init_nonce(&env, &admin, nonce)?;
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Ok(())
    }

    pub fn get_init_nonce(env: Env, admin: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::InitNonce(admin))
            .unwrap_or(0)
    }

    pub fn get_set_limit_nonce(env: Env, admin: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::SetLimitNonce(admin))
            .unwrap_or(0)
    }

    /// Deposits tokens into the bridge vault, minting a cryptographic receipt and updating accumulators.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Amount Guard**: Ensures `amount > 0` and within token limits to avoid zero/negative math bugs.
    /// - **Saturating Cooldown Offsets**: Uses [`u32::saturating_add`] on `last.saturating_add(cooldown)`
    ///   to evaluate the per-depositor `CooldownLedgers` window without ledger wraparound panics.
    ///   `deposit` does not enforce the anti-sandwich delay; it only records `LastDeposit`, which
    ///   [`execute_withdrawal`](FiatBridge::execute_withdrawal) later checks.
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
    ///   Clamped to the admin [`SlippageThreshold`](DataKey::SlippageThreshold) when that is
    ///   non-zero, so passing a larger value cannot loosen the admin policy.
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
    /// * [`Error::SlippageTooHigh`] – If execution price deviates downward beyond
    ///   `min(max_slippage, SlippageThreshold)` (or `max_slippage` when no threshold is set).
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

        // Per-token allowlist (Issue #354). This is the only allowlist: the
        // former global `AllowlistEnabled`/`Allowed` keys had no setter and
        // were removed (Issue #1401).
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

        // Denylist
        Self::reject_if_denied(&env, &from)?;

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
            token: token.clone(),
            amount,
            ledger: env.ledger().sequence(),
            reference,
            memo_hash: memo_hash.clone(),
        };
        let receipt_hash: BytesN<32> = receipt_id.clone().into();
        let receipt_key = DataKey::Receipt(receipt_hash.clone());
        env.storage().persistent().set(&receipt_key, &receipt);
        env.storage()
            .persistent()
            .extend_ttl(&receipt_key, MIN_TTL, MAX_TTL);

        // Store sequential index → hash mapping for enumeration (e.g. migration)
        let index_key = DataKey::ReceiptIndex(receipt_counter);
        env.storage().temporary().set(&index_key, &receipt_hash);
        env.storage()
            .temporary()
            .extend_ttl(&index_key, MIN_TTL, MIN_TTL);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptCounter, &(receipt_counter + 1));

        // If escrow storage migration has already run, directly write the persistent EscrowRecord
        // for post-migration deposits and advance the migration cursor.
        let is_migrated = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::EscrowStorageVersion)
            .unwrap_or(0)
            >= ESCROW_STORAGE_VERSION;

        if is_migrated {
            let escrow = EscrowRecord {
                version: ESCROW_STORAGE_VERSION,
                depositor: from.clone(),
                token: token.clone(),
                amount,
                ledger: env.ledger().sequence(),
                migrated: false,
            };
            let esc_key = DataKey::EscrowRecord(receipt_counter);
            env.storage().persistent().set(&esc_key, &escrow);
            env.storage()
                .persistent()
                .extend_ttl(&esc_key, MIN_TTL, MAX_TTL);
            env.storage()
                .instance()
                .set(&DataKey::EscrowMigrationCursor, &(receipt_counter + 1));
        }

        config.total_deposited = config
            .total_deposited
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        let reg_key = DataKey::TokenRegistry(token.clone());
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

        let user_key = DataKey::UserDeposited(from.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        let new_user_total = user_total.checked_add(amount).ok_or(Error::InternalError)?;
        env.storage().instance().set(&user_key, &new_user_total);

        // Track per-user, per-token available balance
        let balance_key = DataKey::UserAvailableBalance(from.clone(), token.clone());
        let user_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        let new_user_balance = user_balance
            .checked_add(amount)
            .ok_or(Error::InternalError)?;
        env.storage()
            .instance()
            .set(&balance_key, &new_user_balance);

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
            by: from.clone(),
            ledger: env.ledger().sequence(),
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
    /// Called after each fee withdrawal in [`withdraw_fees`] and
    /// [`withdraw_fees_batch`] to prevent admin-declared fees from draining
    /// depositor funds (Issue #1383).
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
    /// * [`Error::OperatorDailyLimitExceeded`] – If `caller` is the withdraw operator and
    ///   `amount` would push its rolling 24h volume above its
    ///   [`set_operator_daily_limit`](FiatBridge::set_operator_daily_limit) cap. The admin is
    ///   not subject to this cap.
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

        let is_admin = caller == admin;
        if !is_admin && operator.as_ref() != Some(&caller) {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();

        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Issue #1403: per-operator rolling 24h volume cap (admin is exempt).
        if !is_admin {
            Self::enforce_operator_daily_limit(&env, &caller, amount)?;
        }

        // ── Issue #109: prevent tokens from being locked inside the contract ──
        if to == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }

        Self::enforce_withdrawal_quota(&env, &to, amount)?;
        // ── Issue #209: circuit breaker check ────────────────────────────
        Self::check_and_update_circuit_breaker(&env, amount)?;
        // Denylist
        Self::reject_if_denied(&env, &to)?;

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
        let reg_key = DataKey::TokenRegistry(token.clone());
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

        Self::check_invariants(&env, &token)?;
        WithdrawEvent {
            version: EVENT_VERSION,
            to: to.clone(),
            token: token.clone(),
            amount,
            by: caller.clone(),
            ledger: env.ledger().sequence(),
        }
        .publish(&env);
        Ok(())
    }

    /// Enqueues a timelocked withdrawal request and records liability in the vault accumulator.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Checked Liabilities Addition**: Adds `amount` to `config.total_liabilities` using
    ///   [`i128::checked_add`], returning [`Error::Overflow`] on overflow.
    /// - **Saturating TTL Calculations**: Computes the receipt TTL extension using
    ///   [`u32::saturating_add`] on `MIN_TTL + lock_period + cooldown_ledgers`.
    /// - **Checked Unlock Ledger Arithmetic**: `unlock_ledger = sequence.checked_add(lock_period)`
    ///   uses [`u32::checked_add`], returning [`Error::Overflow`] on overflow.
    /// - **Checked ID Arithmetic**: The `NextRequestID` and `WithdrawQueueLen` bumps use
    ///   [`u64::checked_add`], returning [`Error::Overflow`] on overflow.
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
        let _admin = Self::require_admin(&env)?;
        Self::require_not_paused(&env)?;
        Self::require_circuit_breaker_clear(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Denylist
        Self::reject_if_denied(&env, &to)?;

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

        let unlock_ledger = env
            .ledger()
            .sequence()
            .checked_add(lock_period)
            .ok_or(Error::Overflow)?;
        let request = WithdrawRequest {
            to: to.clone(),
            token: token.clone(),
            amount,
            unlock_ledger,
            memo_hash: memo_hash.clone(),
            queued_ledger: env.ledger().sequence(),
            risk_tier,
        };
        let queue_key = DataKey::WithdrawQueue(request_id);
        env.storage().persistent().set(&queue_key, &request);
        env.storage()
            .persistent()
            .extend_ttl(&queue_key, MIN_TTL, MAX_TTL);
        let next_id = request_id.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::NextRequestID, &next_id);

        if queue_len == 0 {
            env.storage()
                .instance()
                .set(&DataKey::WithdrawQueueHead, &Some(request_id));
        }
        let new_queue_len = queue_len.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::WithdrawQueueLen, &new_queue_len);

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

        // Check per-user, per-token available balance
        let balance_key = DataKey::UserAvailableBalance(to.clone(), token.clone());
        let user_available: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        if amount > user_available {
            return Err(Error::InsufficientFunds);
        }

        // Reserve the amount from user's available balance
        let new_user_balance = user_available
            .checked_sub(amount)
            .ok_or(Error::InternalError)?;
        env.storage()
            .instance()
            .set(&balance_key, &new_user_balance);

        // Verify the new liabilities don't exceed net deposited
        let new_liabilities = config
            .total_liabilities
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        let net_deposited = config
            .total_deposited
            .saturating_sub(config.total_withdrawn);
        if new_liabilities > net_deposited {
            return Err(Error::InsufficientFunds);
        }

        config.total_liabilities = new_liabilities;
        let reg_key = DataKey::TokenRegistry(token.clone());
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

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
    ///   Clamped to the admin [`SlippageThreshold`](DataKey::SlippageThreshold) when that is
    ///   non-zero, so passing a larger value cannot loosen the admin policy.
    /// * `nonce` – Replay protection nonce corresponding to recipient address.
    ///
    /// # Errors
    /// * [`Error::RequestNotFound`] – If `request_id` does not exist.
    /// * [`Error::AddressDenied`] – If `request.to` was added to the denylist after the request
    ///   was queued. Checked before any state change or transfer; removing the address from the
    ///   denylist makes the request executable again.
    /// * [`Error::StaleNonce`] / [`Error::InvalidNonce`] – If replay protection nonce is invalid.
    /// * [`Error::WithdrawalLocked`] – If request is still within timelock.
    /// * [`Error::AntiSandwichDelayActive`] – If executed before anti-sandwich delay expires.
    /// * [`Error::InsufficientFunds`] – If contract balance is insufficient.
    /// * [`Error::SlippageTooHigh`] – If the oracle price deviates downward beyond
    ///   `min(max_slippage, SlippageThreshold)` (or `max_slippage` when no threshold is set).
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
        let queue_key = DataKey::WithdrawQueue(request_id);
        if env.storage().persistent().has(&queue_key) {
            env.storage()
                .persistent()
                .extend_ttl(&queue_key, MIN_TTL, MAX_TTL);
        }
        let mut request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&queue_key)
            .ok_or(Error::RequestNotFound)?;

        // Denylist: the recipient may have been sanctioned after queuing.
        Self::reject_if_denied(&env, &request.to)?;

        // Validate nonce for replay protection. Checked here without writing
        // (a later failure — lock, slippage, insufficient funds — must not
        // burn it); committed via `consume_nonce` once every check passes.
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalExecutionNonce(request.to.clone()))
            .unwrap_or(0);
        Self::check_nonce(current_nonce, nonce)?;

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

        // Commit the nonce advance now that every validation check has passed.
        Self::consume_nonce(
            &env,
            DataKey::WithdrawalExecutionNonce(request.to.clone()),
            nonce,
        )?;

        token_client.transfer(
            &env.current_contract_address(),
            &request.to,
            &execute_amount,
        );

        if execute_amount == request.amount {
            Self::remove_from_withdraw_queue(&env, request_id, &request);
        } else {
            // Release the unexecuted portion back to user's available balance
            let remaining = request.amount - execute_amount;
            let balance_key =
                DataKey::UserAvailableBalance(request.to.clone(), request.token.clone());
            let user_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
            let new_user_balance = user_balance
                .checked_add(remaining)
                .ok_or(Error::InternalError)?;
            env.storage()
                .instance()
                .set(&balance_key, &new_user_balance);

            request.amount -= execute_amount;
            env.storage().persistent().set(&queue_key, &request);
            env.storage()
                .persistent()
                .extend_ttl(&queue_key, MIN_TTL, MAX_TTL);
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
        let reg_key = DataKey::TokenRegistry(request.token.clone());
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);
        Self::release_liability(&env, &request.token, execute_amount)?;

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
        let _admin = Self::require_admin(&env)?;
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

        // Release the reserved amount back to user's available balance
        let balance_key = DataKey::UserAvailableBalance(request.to.clone(), request.token.clone());
        let user_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        let new_user_balance = user_balance
            .checked_add(request.amount)
            .ok_or(Error::InternalError)?;
        env.storage()
            .instance()
            .set(&balance_key, &new_user_balance);

        Self::release_liability(&env, &request.token, request.amount)?;
        Self::remove_from_withdraw_queue(&env, request_id, &request);

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

        let _admin = Self::require_admin(&env)?;
        Self::require_not_paused(&env)?;

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

        // Release the reserved amount back to user's available balance
        let balance_key = DataKey::UserAvailableBalance(request.to.clone(), request.token.clone());
        let user_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        let new_user_balance = user_balance
            .checked_add(request.amount)
            .ok_or(Error::InternalError)?;
        env.storage()
            .instance()
            .set(&balance_key, &new_user_balance);

        Self::release_liability(&env, &request.token, request.amount)?;
        Self::remove_from_withdraw_queue(&env, request_id, &request);

        Self::check_invariants(&env, &request.token)?;

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

    /// Sets the per-transaction limit for a specific token with replay protection.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Nonce Validation**: Validates and increments the admin's `SetLimitNonce` using checked arithmetic
    ///   to prevent nonce overflow (though practically impossible at u64).
    /// - **Max Cap Guard**: Validates `limit <= max_cap` where `max_cap` defaults to `i128::MAX` but can be
    ///   configured to prevent unbounded limit values.
    /// - **Zero Amount Guard**: Rejects `limit <= 0` via `ZeroAmount` error to prevent zero/negative limits
    ///   (Issue #739). A non-positive limit would make every deposit fail `amount > limit`.
    /// - **Gate Order**: admin → circuit breaker → `limit > 0` → `limit <= max_cap` → token whitelist →
    ///   nonce. Every input check runs before the nonce is consumed and before any state is written,
    ///   so the error a caller sees is deterministic and a rejected call never modifies the token limit.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `token` – The token address for which the limit is being set.
    /// * `limit` – The new per-transaction limit in stroops (must be $> 0$).
    /// * `nonce` – Monotonic replay protection nonce for the admin (from `get_set_limit_nonce`).
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – If the contract has not been initialized.
    /// * [`Error::StaleNonce`] – If the provided nonce is less than the expected nonce.
    /// * [`Error::InvalidNonce`] – If the provided nonce is greater than the expected nonce.
    /// * [`Error::ExceedsLimitMaxCap`] – If `limit > configured_max_cap`.
    /// * [`Error::CircuitBreakerActive`] – If the circuit breaker is currently tripped.
    /// * [`Error::TokenNotWhitelisted`] – If the token is not registered in the token registry.
    /// * [`Error::ZeroAmount`] – If `limit <= 0`.
    pub fn set_limit(env: Env, token: Address, limit: i128, nonce: u64) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;

        // Block if circuit breaker is active
        Self::require_circuit_breaker_clear(&env)?;

        // Issue #739: a zero or negative limit is never a valid configuration
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Check against configured max cap
        let max_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::LimitMaxCap)
            .unwrap_or(i128::MAX);
        if limit > max_cap {
            return Err(Error::ExceedsLimitMaxCap);
        }

        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;

        // Validate and increment nonce for replay protection
        Self::validate_and_increment_set_limit_nonce(&env, &admin, nonce)?;

        config.limit = limit;
        let reg_key = DataKey::TokenRegistry(token.clone());
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

        SetLimitEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            limit,
            by: admin.clone(),
            ledger: env.ledger().sequence(),
        }
        .publish(&env);

        Ok(())
    }

    /// Registers an additional token so it can be deposited, queued for
    /// withdrawal and swept for fees alongside the primary token (Issue #1400).
    ///
    /// The new token gets its own [`TokenConfig`] with zeroed accounting, so its
    /// totals are isolated from every other token. Once registered, the token is
    /// protected from [`rescue_token`](FiatBridge::rescue_token). Its limits can
    /// later be changed with [`set_limit`](FiatBridge::set_limit) and
    /// [`set_daily_deposit_limit`](FiatBridge::set_daily_deposit_limit).
    ///
    /// # Arguments
    /// * `token` – Token contract address to register.
    /// * `limit` – Per-deposit limit in the token's smallest unit (must be $> 0$ and
    ///   $\le$ the configured limit max cap).
    /// * `daily_limit` – Per-user rolling 24h deposit limit (`0` disables it; must be
    ///   $\ge 0$ and $\le$ `limit`).
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] / [`Error::Unauthorized`] – If the caller is not the admin.
    /// * [`Error::ZeroAmount`] – If `limit <= 0`.
    /// * [`Error::ExceedsLimitMaxCap`] – If `limit` exceeds the configured limit max cap.
    /// * [`Error::InvalidAmount`] – If `daily_limit < 0`.
    /// * [`Error::ExceedsLimit`] – If `daily_limit > limit`.
    /// * [`Error::SelfReferentialAddress`] – If `token` is the contract's own address.
    /// * [`Error::TokenAlreadyRegistered`] – If `token` already has a registry entry.
    pub fn register_token(
        env: Env,
        token: Address,
        limit: i128,
        daily_limit: i128,
    ) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }
        let max_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::LimitMaxCap)
            .unwrap_or(i128::MAX);
        if limit > max_cap {
            return Err(Error::ExceedsLimitMaxCap);
        }
        if daily_limit < 0 {
            return Err(Error::InvalidAmount);
        }
        if daily_limit > limit {
            return Err(Error::ExceedsLimit);
        }
        if token == env.current_contract_address() {
            return Err(Error::SelfReferentialAddress);
        }
        let key = DataKey::TokenRegistry(token.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::TokenAlreadyRegistered);
        }
        env.storage().persistent().set(
            &key,
            &TokenConfig {
                limit,
                daily_deposit_limit: daily_limit,
                total_deposited: 0,
                total_withdrawn: 0,
                total_liabilities: 0,
            },
        );
        TokenRegisteredEvent {
            version: EVENT_VERSION,
            token,
            limit,
            daily_limit,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns the registry entry (limits and accounting totals) for `token`,
    /// or `None` if the token is not registered.
    pub fn get_token_config(env: Env, token: Address) -> Option<TokenConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token))
    }

    pub fn set_token_allowlist_enabled(
        env: Env,
        token: Address,
        enabled: bool,
    ) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::TokenAllowlistEnabled(token.clone()), &enabled);

        let entry = TokenAllowlistEnabledEntry {
            token: token.clone(),
            enabled,
        };

        // Issue #1406: keep one index entry per token. A token seen before is
        // updated in its existing slot; only a new token appends a slot.
        let slot_key = DataKey::TokenAllowlistEnabledSlot(token.clone());
        if let Some(slot) = env.storage().persistent().get::<_, u64>(&slot_key) {
            env.storage()
                .persistent()
                .set(&DataKey::TokenAllowlistEnabledIndex(slot), &entry);
            return Ok(());
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenAllowlistEnabledCount)
            .unwrap_or(0);
        if count == u64::MAX {
            return Err(Error::Overflow);
        }
        env.storage()
            .persistent()
            .set(&DataKey::TokenAllowlistEnabledIndex(count), &entry);
        env.storage().persistent().set(&slot_key, &count);
        env.storage().instance().set(
            &DataKey::TokenAllowlistEnabledCount,
            &(count.checked_add(1).ok_or(Error::Overflow)?),
        );

        Ok(())
    }

    pub fn add_token_allowlist(env: Env, token: Address, address: Address) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        let allowed_key = DataKey::TokenAllowed(token.clone(), address.clone());
        // Issue #1406: re-adding a listed pair is a no-op, so the enumeration
        // index never holds duplicate live entries.
        if env.storage().persistent().has(&allowed_key) {
            return Ok(());
        }
        env.storage().persistent().set(&allowed_key, &true);

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
        env.storage().instance().set(
            &DataKey::TokenAllowlistCount,
            &(count.checked_add(1).ok_or(Error::Overflow)?),
        );

        Ok(())
    }

    pub fn remove_token_allowlist(env: Env, token: Address, address: Address) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        let allowed_key = DataKey::TokenAllowed(token.clone(), address.clone());
        // Nothing to remove, so skip the index scan.
        if !env.storage().persistent().has(&allowed_key) {
            return Ok(());
        }
        env.storage().persistent().remove(&allowed_key);

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
        let _admin = Self::require_admin(&env)?;
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

    #[deprecated(note = "use get_config_snapshot instead")]
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
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let _admin = Self::require_admin(&env)?;
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
        let _admin = Self::require_admin(&env)?;

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
        let _admin = Self::require_admin(&env)?;

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

    /// Set the withdrawal lock period in ledgers.
    ///
    /// The lock period must not exceed `MAX_LOCK_PERIOD` (1 year of ledgers)
    /// to prevent overflow in the `unlock_ledger` calculation.
    ///
    /// # Errors
    /// * [`Error::InvalidAmount`] – If `ledgers > MAX_LOCK_PERIOD`.
    pub fn set_lock_period(env: Env, ledgers: u32) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

        if ledgers > MAX_LOCK_PERIOD {
            return Err(Error::InvalidAmount);
        }

        let old_value: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0);
        env.storage().instance().set(&DataKey::LockPeriod, &ledgers);
        SetLockPeriodEvent {
            version: EVENT_VERSION,
            old: old_value,
            new: ledgers,
        }
        .publish(&env);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        PausedEvent {
            version: EVENT_VERSION,
            by: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        UnpausedEvent {
            version: EVENT_VERSION,
            by: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Batch variant of [`unpause`](FiatBridge::unpause): unpauses the contract
    /// `count` times in a single invocation. Each unpause emits its own
    /// `UnpausedEvent` so off-chain indexers see the full sequence. Returns the
    /// number of unpauses actually applied (always equal to `count` on success).
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] – If the caller is not the admin.
    pub fn batch_unpause(env: Env, count: u32) -> Result<u32, Error> {
        let admin = Self::require_admin(&env)?;
        for _ in 0..count {
            env.storage().instance().set(&DataKey::Paused, &false);
            UnpausedEvent {
                version: EVENT_VERSION,
                by: admin.clone(),
            }
            .publish(&env);
        }
        Ok(count)
    }

    /// Set the anti-sandwich delay in ledgers. Use 0 to disable. Requires admin.
    ///
    /// The delay is enforced by [`execute_withdrawal`](FiatBridge::execute_withdrawal), not by
    /// `deposit`: executing a withdrawal for a recipient whose last deposit was less than
    /// `ledgers` ago returns [`Error::AntiSandwichDelayActive`]. `deposit` only enforces
    /// `CooldownLedgers` (returning [`Error::CooldownActive`]) and records the deposit ledger
    /// that the anti-sandwich check reads.
    ///
    /// # Errors
    /// * [`Error::InvalidAmount`] – If `ledgers == u32::MAX`.
    pub fn set_anti_sandwich_delay(env: Env, ledgers: u32) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

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
        let admin = Self::require_admin(&env)?;
        if new_admin == admin {
            return Err(Error::SameAdmin);
        }
        let proposed_at = env.ledger().sequence() as u64;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &(new_admin.clone(), proposed_at));
        AdminTransferEvent {
            version: EVENT_VERSION,
            old_admin: admin,
            new_admin,
        }
        .publish(&env);
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
        let unlock_at = proposed_at
            .checked_add(MIN_TIMELOCK_DELAY as u64)
            .ok_or(Error::Overflow)?;
        if current < unlock_at {
            return Err(Error::ActionNotReady);
        }
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        AdminTransferEvent {
            version: EVENT_VERSION,
            old_admin,
            new_admin: pending,
        }
        .publish(&env);
        Ok(())
    }

    // ── Fiat Limits & Oracle ──────────────────────────────────────────────
    /// Set the oracle contract address for fiat price validation. Requires admin.
    /// Returns Error::SelfReferentialAddress if oracle == admin or contract.
    pub fn set_oracle(env: Env, oracle: Address) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;

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
        let _admin = Self::require_admin(&env)?;
        if limit_usd_cents < 0 {
            return Err(Error::InvalidAmount);
        }
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
    /// * `max_slippage_bps` – Caller-requested maximum downward slippage in basis points
    ///   (1 BPS = 0.01%). When the admin has set a non-zero
    ///   [`SlippageThreshold`](DataKey::SlippageThreshold), this is clamped to
    ///   `min(max_slippage_bps, threshold)`, so a caller can tighten but never
    ///   loosen the admin policy (Issue #1402).
    ///
    /// # Errors
    /// * [`Error::SlippageTooHigh`] – If downward price slippage exceeds the effective
    ///   (clamped) tolerance.
    fn check_slippage(
        env: &Env,
        expected_price: i128,
        actual_price: i128,
        max_slippage_bps: u32,
    ) -> Result<(), Error> {
        if expected_price <= 0 {
            return Ok(()); // Skip if no benchmark provided
        }

        // Issue #1402: the admin threshold caps the caller-supplied tolerance.
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SlippageThreshold)
            .unwrap_or(0);
        let max_slippage_bps = if threshold > 0 {
            max_slippage_bps.min(threshold)
        } else {
            max_slippage_bps
        };

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
        let fiat_limit = env.storage().instance().get::<_, i128>(&DataKey::FiatLimit);
        let oracle_addr = env.storage().instance().get::<_, Address>(&DataKey::Oracle);

        let price = if let Some(addr) = oracle_addr {
            let oracle = crate::oracle::OracleClient::new(env, &addr);
            let p = oracle.get_price(token).unwrap_or(0);
            if p <= 0 {
                return Err(Error::OraclePriceInvalid);
            }
            p
        } else if fiat_limit.is_some() && fiat_limit != Some(0) {
            return Err(Error::OracleNotSet);
        } else {
            0
        };

        if let Some(limit) = fiat_limit {
            if limit > 0 {
                // ── Issue #220: use precision-safe fixed-point math ───────────
                let usd_cents =
                    crate::math::mul_div_floor(amount, price, ORACLE_PRICE_DECIMALS / 100);
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

    /// Adds `amount` to `operator`'s rolling 24h `withdraw` volume, failing with
    /// [`Error::OperatorDailyLimitExceeded`] if that would exceed the configured
    /// limit. A missing or zero limit disables the check. The volume lives in
    /// temporary storage, so it simply expires once the window is over.
    fn enforce_operator_daily_limit(
        env: &Env,
        operator: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        let limit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::OperatorDailyLimit(operator.clone()))
            .unwrap_or(0);
        if limit <= 0 {
            return Ok(());
        }

        let curr = env.ledger().sequence();
        let key = DataKey::OperatorDailyVolume(operator.clone());
        let mut vol: GlobalDailyWithdrawn =
            env.storage()
                .temporary()
                .get(&key)
                .unwrap_or(GlobalDailyWithdrawn {
                    amount: 0,
                    window_start: curr,
                });
        if curr >= vol.window_start.saturating_add(WINDOW_LEDGERS) {
            vol.amount = 0;
            vol.window_start = curr;
        }

        let new_total = vol.amount.checked_add(amount).ok_or(Error::Overflow)?;
        if new_total > limit {
            return Err(Error::OperatorDailyLimitExceeded);
        }
        vol.amount = new_total;
        env.storage().temporary().set(&key, &vol);
        env.storage()
            .temporary()
            .extend_ttl(&key, WINDOW_LEDGERS, WINDOW_LEDGERS);
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
        let _admin = Self::require_admin(&env)?;
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
        let _admin = Self::require_admin(&env)?;
        let action: QueuedAdminAction = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(id))
            .ok_or(Error::ActionNotQueued)?;
        if env.ledger().sequence() <= action.target_ledger {
            return Err(Error::ActionNotReady);
        }

        // Execute the action by dispatching on action_type
        let op = BatchAdminOp {
            op_type: action.action_type.clone(),
            payload: action.payload.clone(),
        };
        Self::execute_single_admin_op(&env, &op)?;

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

    pub fn cancel_admin_action(env: Env, id: u64) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        let _action: QueuedAdminAction = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(id))
            .ok_or(Error::ActionNotQueued)?;
        env.storage()
            .persistent()
            .remove(&DataKey::QueuedAdminAction(id));
        AdminActionExecutedEvent {
            version: EVENT_VERSION,
            action_id: id,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_queued_admin_action(env: Env, id: u64) -> Option<QueuedAdminAction> {
        env.storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(id))
    }

    // ── Operator Role & Heartbeat ───────────────────────────────────────
    /// Set the active status of an operator address.
    ///
    /// The `nonce` parameter is a replay-protection nonce keyed on the admin
    /// address (not the operator). Use `get_set_operator_nonce` to read the
    /// current nonce for an admin.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `operator` – The operator address to activate or deactivate.
    /// * `active` – Whether the operator should be active.
    /// * `nonce` – Admin-keyed replay-protection nonce.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] – If the caller is not the admin.
    /// * [`Error::InvalidNonce`] – If the provided nonce does not match the current admin nonce.
    /// * [`Error::StaleNonce`] – If the provided nonce is lower than the current admin nonce.
    pub fn set_operator(
        env: Env,
        operator: Address,
        active: bool,
        nonce: u64,
    ) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;

        // Reject admin as operator (role confusion guard)
        if operator == admin {
            return Err(Error::NotAllowed);
        }
        // Reject contract address as operator
        if operator == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }

        // Validate and increment nonce for replay protection (admin-keyed)
        let new_nonce = Self::consume_nonce(&env, DataKey::SetOperatorNonce(admin.clone()), nonce)?;

        NonceConsumedEvent {
            version: EVENT_VERSION,
            scope: Symbol::new(&env, "set_operator"),
            owner: admin.clone(),
            new_nonce,
        }
        .publish(&env);

        Self::prune_inactive_operators_internal(&env);
        let was_active = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator.clone()))
            .unwrap_or(false);

        // Record activation ledger when activating an operator
        if active && !was_active {
            env.storage().instance().set(
                &DataKey::OperatorActivatedAt(operator.clone()),
                &env.ledger().sequence(),
            );
            let nonce_key = DataKey::OperatorNonce(operator.clone());
            if !env.storage().instance().has(&nonce_key) {
                env.storage().instance().set(&nonce_key, &1u64);
            }
        }

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

        // Boundary check: adding a new operator must not exceed the configured
        // cap. max_operators == 0 is the "unlimited" sentinel and bypasses the
        // check. This guard must come after prune_inactive_operators_internal
        // so operators.len() reflects the true live count.
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
            by: admin.clone(),
            ledger: env.ledger().sequence(),
        }
        .publish(&env);

        Ok(())
    }

    pub fn set_max_operators(env: Env, max_operators: u32) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

        // Use the live operator list (not the cached OperatorCount) so that
        // any operators pruned since the last set_operator call are excluded.
        // This prevents set_max_operators from accepting a cap that is already
        // violated by the true active-operator count.
        let live_operators = Self::get_operator_list(&env);
        let mut retained_count: u32 = 0;
        for op in live_operators.iter() {
            let is_active = env
                .storage()
                .instance()
                .get::<_, bool>(&DataKey::Operator(op.clone()))
                .unwrap_or(false);
            if is_active {
                retained_count = retained_count.saturating_add(1);
            }
        }

        // Reject if the new cap (when non-zero) would be below the live count.
        if max_operators > 0 && retained_count > max_operators {
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
            active_operators: retained_count,
        }
        .publish(&env);

        Ok(())
    }

    /// Set the inactivity threshold for operator pruning and emergency recovery.
    ///
    /// Operators who have not sent a heartbeat or been activated within this
    /// number of ledgers will be pruned by `prune_inactive_operators`.
    /// When the admin has been inactive for this many ledgers, emergency recovery
    /// may be triggered.
    pub fn set_inactivity_threshold(env: Env, threshold: u32) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        if !(MIN_INACTIVITY_THRESHOLD..=MAX_INACTIVITY_THRESHOLD).contains(&threshold) {
            return Err(Error::InvalidAmount);
        }
        let old_threshold = env
            .storage()
            .instance()
            .get(&DataKey::InactivityThreshold)
            .unwrap_or(DEFAULT_INACTIVITY_THRESHOLD);
        env.storage()
            .instance()
            .set(&DataKey::InactivityThreshold, &threshold);
        InactivityThresholdSetEvent {
            version: EVENT_VERSION,
            admin,
            old_threshold,
            new_threshold: threshold,
        }
        .publish(&env);
        Ok(())
    }

    /// Return the currently configured inactivity threshold, or DEFAULT_INACTIVITY_THRESHOLD.
    pub fn get_inactivity_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::InactivityThreshold)
            .unwrap_or(DEFAULT_INACTIVITY_THRESHOLD)
    }

    /// Return the ledger sequence of the most recent admin-authenticated action.
    pub fn get_last_admin_action_ledger(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::LastAdminActionLedger)
            .unwrap_or(0)
    }

    /// Get the current set_operator nonce for an admin.
    ///
    /// This nonce is used for replay protection on `set_operator` calls and is
    /// keyed on the admin address, separate from the operator's heartbeat nonce.
    pub fn get_set_operator_nonce(env: Env, admin: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::SetOperatorNonce(admin))
            .unwrap_or(0)
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
    /// Denying an address that is already denied is a no-op: no index entry is
    /// appended and no event is emitted (Issue #1405).
    ///
    /// # Errors
    /// * [`Error::MaxDeniedReached`] – If denylist capacity reaches `u64::MAX`.
    /// * [`Error::Overflow`] – If counter increment overflows `u64`.
    pub fn deny_address(env: Env, address: Address) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        let denied_key = DataKey::Denied(address.clone());
        if env.storage().persistent().has(&denied_key) {
            env.storage()
                .persistent()
                .extend_ttl(&denied_key, MIN_TTL, MAX_TTL);
            return Ok(());
        }
        env.storage().persistent().set(&denied_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&denied_key, MIN_TTL, MAX_TTL);

        // Append to denied-address index for enumeration
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0);
        if count == u64::MAX {
            return Err(Error::MaxDeniedReached);
        }
        let index_key = DataKey::DeniedIndex(count);
        env.storage()
            .persistent()
            .set(&index_key, &Some(address.clone()));
        env.storage()
            .persistent()
            .extend_ttl(&index_key, MIN_TTL, MAX_TTL);
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

    pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error> {
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
    /// - **Events**: Emits individual `HeartbeatEvent`s for successes,
    ///   `HeartbeatBatchFailEvent` for any failed item, and a summary `HeartbeatBatchEvent`.
    pub fn heartbeat_batch(
        env: Env,
        items: Vec<HeartbeatItem>,
    ) -> Result<BatchHeartbeatResult, Error> {
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

    pub fn get_operator_nonce(env: Env, operator: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OperatorNonce(operator))
            .unwrap_or(0)
    }

    pub fn prune_inactive_operators(env: Env) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        Self::prune_inactive_operators_internal(&env);
        Ok(())
    }

    /// Pure comparison used by every nonce site: `provided` must equal
    /// `current` exactly. A lower value means the caller replayed an
    /// already-used nonce; a higher value means the caller raced ahead of
    /// what this contract has recorded.
    fn check_nonce(current: u64, provided: u64) -> Result<(), Error> {
        if provided != current {
            if provided < current {
                return Err(Error::StaleNonce);
            } else {
                return Err(Error::InvalidNonce);
            }
        }
        Ok(())
    }

    /// Validate `provided` against the nonce stored at `key` and, on
    /// success, atomically advance it. Every replay-protection nonce in this
    /// contract should be consumed through this one function rather than
    /// re-implementing the compare-then-increment dance inline.
    ///
    /// Returns the new (post-increment) nonce so callers can use it directly
    /// in an event or return value without a second storage read.
    fn consume_nonce(env: &Env, key: DataKey, provided: u64) -> Result<u64, Error> {
        let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
        Self::check_nonce(current, provided)?;
        let next = current.checked_add(1).ok_or(Error::Overflow)?;
        env.storage().instance().set(&key, &next);
        Ok(next)
    }

    fn validate_and_increment_nonce(
        env: &Env,
        operator: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let new_nonce = Self::consume_nonce(
            env,
            DataKey::OperatorNonce(operator.clone()),
            provided_nonce,
        )?;

        NonceConsumedEvent {
            version: EVENT_VERSION,
            scope: Symbol::new(env, "operator"),
            owner: operator.clone(),
            new_nonce,
        }
        .publish(env);

        Ok(())
    }

    fn validate_and_increment_set_limit_nonce(
        env: &Env,
        admin: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let new_nonce =
            Self::consume_nonce(env, DataKey::SetLimitNonce(admin.clone()), provided_nonce)?;

        NonceConsumedEvent {
            version: EVENT_VERSION,
            scope: Symbol::new(env, "set_limit"),
            owner: admin.clone(),
            new_nonce,
        }
        .publish(env);

        Ok(())
    }

    fn validate_and_increment_init_nonce(
        env: &Env,
        admin: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let new_nonce =
            Self::consume_nonce(env, DataKey::InitNonce(admin.clone()), provided_nonce)?;

        NonceConsumedEvent {
            version: EVENT_VERSION,
            scope: Symbol::new(env, "init"),
            owner: admin.clone(),
            new_nonce,
        }
        .publish(env);

        Ok(())
    }

    /// Prunes operators who have exceeded the inactivity threshold.
    ///
    /// This function iterates through all operators and deactivates any that
    /// have not sent a heartbeat within the configured inactivity threshold.
    /// This is a critical security mechanism to ensure that compromised or
    /// abandoned operator keys cannot maintain control over the contract.
    ///
    /// # Inactivity Threshold Logic
    /// - Each operator must periodically call `heartbeat()` to prove liveness
    /// - The threshold is configurable via `InactivityThreshold` storage key
    /// - Defaults to `DEFAULT_INACTIVITY_THRESHOLD` (~3 months)
    /// - Operators without any heartbeat record are considered inactive
    /// - An operator is pruned when `current_ledger - max(last_heartbeat, activated_at) > threshold`
    ///
    /// # Security Properties
    /// - Prevents long-term operator key compromise from affecting operations
    /// - Ensures operators remain actively engaged with protocol operations
    /// - Allows automatic recovery without manual intervention
    /// - Emits `OperatorPrunedEvent` for audit trail
    ///
    /// # Parameters
    /// - `env`: The contract environment
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
            let activated_at = env
                .storage()
                .instance()
                .get::<_, u32>(&DataKey::OperatorActivatedAt(operator.clone()));

            // An operator is inactive if:
            // - They have no heartbeat record, OR
            // - The time since their last heartbeat exceeds the threshold
            // - We use max(last_heartbeat, activated_at) to handle operators who never sent a heartbeat
            let last_activity: Option<u32> = match (heartbeat, activated_at) {
                (Some(hb), Some(aa)) => Some(hb.max(aa)),
                (Some(hb), None) => Some(hb),
                (None, Some(aa)) => Some(aa),
                (None, None) => None,
            };

            let is_inactive = match last_activity {
                None => true,
                Some(activity) => current_ledger.saturating_sub(activity) > threshold,
            };

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
        let _admin = Self::require_admin(&env)?;

        // Design decision: block renounce while paused.
        // If we allowed queuing while paused, the timelock could elapse and
        // execute_renounce_admin would leave the contract permanently paused
        // with no admin able to unpause it. Requiring an explicit unpause first
        // forces the admin to consciously restore normal operations before
        // giving up control.
        Self::require_not_paused(&env)?;

        let current_ledger = env.ledger().sequence();
        let target_ledger = current_ledger
            .checked_add(MIN_TIMELOCK_DELAY)
            .ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingRenounceLedger, &target_ledger);
        Ok(())
    }

    /// Removes an address from the denylist and tombstones its index slot.
    /// Removing an address that is not denied is a no-op and emits no event.
    pub fn remove_denied_address(env: Env, address: Address) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        let denied_key = DataKey::Denied(address.clone());
        if !env.storage().persistent().has(&denied_key) {
            return Ok(());
        }
        env.storage().persistent().remove(&denied_key);

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
    /// `false` otherwise. A denied address cannot `deposit`, and cannot be the
    /// `to` recipient of `withdraw` or `request_withdrawal`. View functions do
    /// not consult the denylist, so a denied address can still read contract
    /// state.
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
        // Boundary check: index lookups must stay within count range
        if count > 0 {
            for i in 0..count {
                let _ = env
                    .storage()
                    .persistent()
                    .get::<_, Option<Address>>(&DataKey::DeniedIndex(i))
                    .ok_or(Error::Overflow)?;
            }
        }
        let denied_key = DataKey::Denied(address.clone());
        let denied = env.storage().persistent().has(&denied_key);
        if denied {
            env.storage()
                .persistent()
                .extend_ttl(&denied_key, MIN_TTL, MAX_TTL);
        }
        IsDeniedCheckedEvent {
            version: EVENT_VERSION,
            address,
            is_denied: denied,
        }
        .publish(&env);
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
                if env.storage().persistent().has(&DataKey::TokenAllowed(
                    entry.token.clone(),
                    entry.address.clone(),
                )) {
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

    pub fn get_token_allowlist_enabled(
        env: Env,
        offset: u64,
        limit: u32,
    ) -> Vec<TokenAllowlistEnabledEntry> {
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
    /// Records that protocol fees have been received for a token.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Amount Validation**: Ensures `amount > 0` to prevent zero/negative fee accrual.
    /// - **Unbounded Ledger**: `accrue_fee` does not compare the fee vault against the contract's
    ///   token balance, so the recorded vault can exceed what the contract actually holds.
    /// - **Plain Addition**: Updates the vault with plain `current + amount`. The release profile
    ///   sets `overflow-checks = true`, so an overflow traps and aborts the transaction.
    /// - **No Reconciliation**: No function corrects the vault ledger against the on-chain
    ///   balance. [`withdraw_fees`](FiatBridge::withdraw_fees) only emits
    ///   `FeeVaultReconciledEvent` when the ledger exceeds the balance.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `token` – The token address for which fees are being accrued.
    /// * `amount` – The amount of fees received in stroops (must be $> 0$).
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – If the contract has not been initialized.
    /// * [`Error::ZeroAmount`] – If `amount <= 0`.
    pub fn accrue_fee(env: Env, token: Address, amount: i128) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let key = DataKey::FeeVault(token.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL, MAX_TTL);

        FeeAccruedEvent {
            version: EVENT_VERSION,
            token: token.clone(),
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_renounce_admin(env: Env) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

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
        let reg_key = DataKey::TokenRegistry(token.clone());
        if !env.storage().persistent().has(&reg_key) {
            return 0;
        }
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

        // Edge case: clamp to 0 — fees are a non-negative accumulator and a
        // negative stored value would indicate corruption, not a real debt.
        let fee_key = DataKey::FeeVault(token);
        let fees: i128 = env.storage().persistent().get(&fee_key).unwrap_or(0);
        if env.storage().persistent().has(&fee_key) {
            env.storage()
                .persistent()
                .extend_ttl(&fee_key, MIN_TTL, MAX_TTL);
        }
        fees.max(0)
    }

    /// Admin-only variant of `get_accrued_fees` that enforces a timelock role
    /// check before returning the vault balance.
    ///
    /// Unlike the public `get_accrued_fees`, this entry point requires the
    /// caller to authenticate as the current admin (#763). This is the
    /// appropriate path for backend tooling and dashboards that need a
    /// guaranteed, tamper-evident read — they cannot be spoofed by an
    /// unauthenticated caller pretending the result came from an admin query.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] — if `caller` is not the current admin.
    pub fn get_accrued_fees_authenticated(
        env: Env,
        caller: Address,
        token: Address,
    ) -> Result<i128, Error> {
        caller.require_auth();
        let _admin = Self::require_admin(&env)?;
        if _admin != caller {
            return Err(Error::Unauthorized);
        }

        let reg_key = DataKey::TokenRegistry(token.clone());
        if !env.storage().persistent().has(&reg_key) {
            return Ok(0);
        }
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);

        let fee_key = DataKey::FeeVault(token);
        let fees: i128 = env.storage().persistent().get(&fee_key).unwrap_or(0);
        if env.storage().persistent().has(&fee_key) {
            env.storage()
                .persistent()
                .extend_ttl(&fee_key, MIN_TTL, MAX_TTL);
        }
        Ok(fees)
    }

    /// Withdraws accrued protocol fees for a specific token to the fee recipient.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Zero Amount Guard**: Rejects `amount <= 0` to prevent zero/negative withdrawals.
    /// - **Vault Balance Guard**: Validates `amount <= current_accrued_fees` before state changes,
    ///   ensuring `current - amount` cannot underflow.
    /// - **Reconciliation Signal**: Before transfer, compares the vault ledger with the contract's
    ///   token balance and emits `FeeVaultReconciledEvent` if the ledger is higher. It does not
    ///   cap `amount` or adjust the vault; the transfer is attempted for the full `amount`.
    /// - **Guarded Subtraction**: Updates `FeeVault` with guarded subtraction `current - amount` after validation.
    /// - **Nonce Increment**: Increments caller's `FeeWithdrawalNonceByCaller` with checked arithmetic
    ///   to prevent nonce overflow (though practically impossible at u64).
    /// - **Invariant Check**: Calls [`check_invariants`](FiatBridge::check_invariants) after transfer
    ///   to ensure `balance >= net_deposited`, preventing fee withdrawals from draining depositor funds
    ///   (Issue #1383).
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `to` – Fallback recipient address (overridden if `FeeRecipient` is set in configuration).
    /// * `token` – Token contract address.
    /// * `amount` – Fee amount in stroops to withdraw.
    /// * `nonce` – Replay protection nonce.
    ///
    /// # Errors
    /// * [`Error::NotInitialized`] – If the contract has not been initialized.
    /// * [`Error::ZeroAmount`] – If `amount <= 0`.
    /// * [`Error::NoFeesToWithdraw`] – If no fees are accrued in the vault.
    /// * [`Error::FeeWithdrawalExceedsBalance`] – If `amount > current_accrued_fees`.
    /// * [`Error::StaleNonce`] – If nonce is too low (already used).
    /// * [`Error::InvalidNonce`] – If nonce is too high (future nonce).
    pub fn withdraw_fees(
        env: Env,
        to: Address,
        token: Address,
        amount: i128,
        nonce: u64,
    ) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // ── Issue #829 / #1420: validate against the same per-caller nonce
        // that withdraw_fees_batch consumes, so the two entrypoints share one
        // replay-protection sequence (checked here without writing, so a
        // failure below — no fees, amount too large — doesn't burn it).
        let nonce_key = DataKey::FeeWithdrawalNonceByCaller(admin.clone());
        let current_nonce: u64 = env.storage().instance().get(&nonce_key).unwrap_or(0);
        Self::check_nonce(current_nonce, nonce)?;

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
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL, MAX_TTL);
        // Commit the nonce advance now that every failure path has passed.
        Self::consume_nonce(&env, nonce_key, nonce)?;
        FeeWithdrawnEvent {
            version: EVENT_VERSION,
            to: recipient,
            amount,
            token: token.clone(),
        }
        .publish(&env);

        // Issue #1383: check invariants after fee withdrawal to prevent draining depositor funds
        Self::check_invariants(&env, &token)?;

        Ok(())
    }

    /// Withdraw accrued fees for multiple tokens using the shared fee-withdrawal nonce.
    ///
    /// Only the admin may call this entrypoint; `nonce` must match the current admin nonce.
    pub fn withdraw_fees_batch(
        env: Env,
        to: Address,
        tokens: Vec<Address>,
        nonce: u64,
    ) -> Result<(), Error> {
        // ── Issue #1041: emit telemetry event
        Self::emit_telemetry(&env, Symbol::new(&env, "withdraw_fees_batch"));

        let admin = Self::require_admin(&env)?;
        let nonce_key = DataKey::FeeWithdrawalNonceByCaller(admin.clone());
        let current_nonce: u64 = env.storage().instance().get(&nonce_key).unwrap_or(0);
        Self::check_nonce(current_nonce, nonce)?;

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
            env.storage()
                .persistent()
                .extend_ttl(&key, MIN_TTL, MAX_TTL);
            FeeWithdrawnEvent {
                version: EVENT_VERSION,
                to: recipient.clone(),
                amount: current,
                token: token.clone(),
            }
            .publish(&env);

            // Unregistered tokens have no tracked depositor liabilities to protect.
            if env
                .storage()
                .persistent()
                .has(&DataKey::TokenRegistry(token.clone()))
            {
                Self::check_invariants(&env, &token)?;
            }
        }

        Self::validate_and_increment_fee_withdrawal_nonce(&env, &admin, nonce)?;

        Ok(())
    }

    pub fn execute_renounce_admin(env: Env) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
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
        let admin = Self::require_admin(&env)?;

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Reject i128::MAX to prevent overflow in subsequent arithmetic
        if amount == i128::MAX {
            return Err(Error::ExceedsLimit);
        }

        // Reject self-referential addresses - rescuing to admin or contract address is meaningless
        if to == admin {
            return Err(Error::InvalidRecipient);
        }
        if to == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
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

    /// Returns the lifetime total deposits for a user across all tokens.
    /// This is a historical aggregate and does not reflect available balance.
    /// Use `get_user_available_balance` for the actual withdrawable amount per token.
    pub fn get_user_lifetime_deposited(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserDeposited(user))
            .unwrap_or(0)
    }

    /// Returns the available balance for a user for a specific token.
    /// This is the amount that can be requested for withdrawal, accounting for
    /// all pending withdrawal requests.
    pub fn get_user_available_balance(env: Env, user: Address, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserAvailableBalance(user, token))
            .unwrap_or(0)
    }

    /// Deprecated: use `get_user_lifetime_deposited` for clarity.
    /// This method is kept for backward compatibility but returns the lifetime
    /// total, not the available balance.
    #[deprecated(note = "use get_user_lifetime_deposited for clarity")]
    pub fn get_user_deposited(env: Env, user: Address) -> i128 {
        Self::get_user_lifetime_deposited(env, user)
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
    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_lock_period(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0)
    }
    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_cooldown(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CooldownLedgers)
            .unwrap_or(0)
    }
    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_withdrawal_cooldown(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawCooldownLedgers)
            .unwrap_or(0)
    }
    #[deprecated(note = "use get_config_snapshot instead")]
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
    /// Set the protocol-wide maximum slippage, in basis points (BPS).
    ///
    /// 1 BPS = 0.01%, so 10000 BPS = 100%. When non-zero, [`deposit`](FiatBridge::deposit)
    /// and [`execute_withdrawal`](FiatBridge::execute_withdrawal) clamp the caller-supplied
    /// `max_slippage` to this value, so a caller can only tighten the admin policy, never
    /// loosen it. `0` disables the cap and the caller's `max_slippage` is used as-is.
    /// The same value can also be set through the `set_slippage_threshold` batch op.
    ///
    /// # Parameters
    ///
    /// - `threshold_bps` – the slippage threshold in basis points (0-10000; 0 = no cap)
    ///
    /// # Errors
    ///
    /// - `Error::NotInitialized` – if the contract has not been initialized
    /// - `Error::Unauthorized` – if the caller is not the admin
    /// - `Error::SlippageTooHigh` – if the threshold exceeds 10000 BPS (100%)
    /// - `Error::InvalidAmount` – if the threshold is u32::MAX
    pub fn set_slippage_threshold(env: Env, threshold_bps: u32) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

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
        SlippageThresholdSetEvent {
            version: EVENT_VERSION,
            threshold_bps,
        }
        .publish(&env);
        Ok(())
    }

    // ── Issue #1044: fee recipient management ───────────────────────────
    pub fn set_fee_recipient(env: Env, recipient: Address) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

        if recipient == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }

        let old_recipient = env.storage().instance().get(&DataKey::FeeRecipient);
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &recipient);

        FeeRecipientSetEvent {
            version: EVENT_VERSION,
            old_recipient,
            new_recipient: Some(recipient),
        }
        .publish(&env);

        Ok(())
    }

    pub fn clear_fee_recipient(env: Env) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

        let old_recipient = env.storage().instance().get(&DataKey::FeeRecipient);
        env.storage().instance().remove(&DataKey::FeeRecipient);

        FeeRecipientSetEvent {
            version: EVENT_VERSION,
            old_recipient,
            new_recipient: None,
        }
        .publish(&env);

        Ok(())
    }

    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_fee_recipient(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::FeeRecipient)
    }

    pub fn get_receipt_by_index(env: Env, idx: u64) -> Option<Receipt> {
        let max_receipts: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);
        if idx >= max_receipts {
            // Out-of-bounds index: return None rather than reading past the
            // known receipt range.
            ReceiptIndexOutOfBoundsEvent {
                version: EVENT_VERSION,
                index: idx,
                receipt_count: max_receipts,
            }
            .publish(&env);
            return None;
        }
        let receipt_hash: BytesN<32> =
            env.storage().temporary().get(&DataKey::ReceiptIndex(idx))?;
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(receipt_hash))
    }

    pub fn get_withdrawal_request(env: Env, id: u64) -> Option<WithdrawRequest> {
        let key = DataKey::WithdrawQueue(id);
        let req = env.storage().persistent().get(&key);
        if req.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, MIN_TTL, MAX_TTL);
        }
        req
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

    #[deprecated(note = "use get_config_snapshot instead")]
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
            version: CONFIG_SNAPSHOT_VERSION,
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
            emergency_recovery: env
                .storage()
                .instance()
                .get(&DataKey::EmergencyRecoveryAddress),
            anti_sandwich_delay: env
                .storage()
                .instance()
                .get(&DataKey::AntiSandwichDelay)
                .unwrap_or(0),
            paused: env
                .storage()
                .instance()
                .get(&DataKey::Paused)
                .unwrap_or(false),
            min_deposit: env
                .storage()
                .instance()
                .get(&DataKey::MinDeposit)
                .unwrap_or(1),
            fee_recipient: env.storage().instance().get(&DataKey::FeeRecipient),
            withdraw_operator: env.storage().instance().get(&DataKey::WithdrawOperator),
            withdrawal_quota: env
                .storage()
                .instance()
                .get(&DataKey::WithdrawalQuota)
                .unwrap_or(0),
            withdrawal_cooldown_ledgers: env
                .storage()
                .instance()
                .get(&DataKey::WithdrawCooldownLedgers)
                .unwrap_or(0),
            withdrawal_cooldown_threshold: env
                .storage()
                .instance()
                .get(&DataKey::WithdrawCooldownThreshold)
                .unwrap_or(0),
            withdrawal_expiry_window: env
                .storage()
                .instance()
                .get(&DataKey::WithdrawalExpiryWindow)
                .unwrap_or(WITHDRAWAL_EXPIRY_WINDOW_LEDGERS),
            slippage_threshold: env
                .storage()
                .instance()
                .get(&DataKey::SlippageThreshold)
                .unwrap_or(0),
            upgrade_delay: env
                .storage()
                .instance()
                .get(&DataKey::UpgradeDelay)
                .unwrap_or(MIN_UPGRADE_DELAY),
            circuit_breaker_threshold: env
                .storage()
                .instance()
                .get(&DataKey::CircuitBreakerThreshold)
                .unwrap_or(0),
            circuit_breaker_reset_window: env
                .storage()
                .instance()
                .get(&DataKey::CircuitBreakerResetWindow)
                .unwrap_or(CIRCUIT_BREAKER_RESET_LEDGERS),
            multisig_threshold: env
                .storage()
                .instance()
                .get(&DataKey::Threshold)
                .unwrap_or(0),
        })
    }

    // ── Withdrawal Quota ──────────────────────────────────────────────────
    pub fn set_withdrawal_quota(env: Env, quota: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let _admin = Self::require_admin(&env)?;
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

    #[deprecated(note = "use get_config_snapshot instead")]
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
        let _admin = Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalExpiryWindow, &ledgers);
        Ok(())
    }

    #[deprecated(note = "use get_config_snapshot instead")]
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

    /// Loads the configured admin, requires their authentication, and
    /// returns the address. Replaces the 50+ inline copies of
    /// `let admin: Address = env.storage().instance().get(&DataKey::Admin)
    /// .ok_or(Error::NotInitialized)?; admin.require_auth();` that used to
    /// appear at every admin-gated entrypoint.
    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        Ok(admin)
    }

    /// Returns [`Error::AddressDenied`] when `address` is on the denylist.
    fn reject_if_denied(env: &Env, address: &Address) -> Result<(), Error> {
        let key = DataKey::Denied(address.clone());
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, MIN_TTL, MAX_TTL);
            return Err(Error::AddressDenied);
        }
        Ok(())
    }

    /// Removes a fully-settled withdrawal request from both the global and
    /// per-tier queue bookkeeping. Shared by `execute_withdrawal`,
    /// `cancel_withdrawal`, and `reclaim_expired_withdrawal`, which otherwise
    /// each repeated the same remove/decrement/advance sequence.
    fn remove_from_withdraw_queue(env: &Env, request_id: u64, request: &WithdrawRequest) {
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
        Self::advance_withdraw_queue_head(env, request_id);

        let tier = request.risk_tier;
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
        Self::advance_tier_queue_head(env, tier, request_id);
    }

    /// Releases `amount` of previously-reserved liability for `token` using
    /// checked subtraction. Shared by `execute_withdrawal`,
    /// `cancel_withdrawal`, and `reclaim_expired_withdrawal`, which used to
    /// each do this with an unchecked `-=`.
    fn release_liability(env: &Env, token: &Address, amount: i128) -> Result<(), Error> {
        let reg_key = DataKey::TokenRegistry(token.clone());
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&reg_key)
            .ok_or(Error::TokenNotWhitelisted)?;
        config.total_liabilities = config
            .total_liabilities
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;
        env.storage().persistent().set(&reg_key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);
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
    /// Returns count migrated in this batch. Requires admin. Emits MigrationEvent.
    pub fn migrate_escrow(env: Env, batch_size: u32) -> Result<u32, Error> {
        let _admin = Self::require_admin(&env)?;

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

        if cursor >= receipt_counter {
            return Err(Error::MigrationAlreadyComplete);
        }

        let mut migrated_count: u32 = 0;
        let mut current_id = cursor;

        while current_id < receipt_counter && migrated_count < batch_size {
            // Look up the hash stored at this sequential index position
            if let Some(receipt_hash) = env
                .storage()
                .temporary()
                .get::<_, BytesN<32>>(&DataKey::ReceiptIndex(current_id))
            {
                let receipt_key = DataKey::Receipt(receipt_hash);
                if let Some(receipt) = env.storage().persistent().get::<_, Receipt>(&receipt_key) {
                    let escrow = EscrowRecord {
                        version: ESCROW_STORAGE_VERSION,
                        depositor: receipt.depositor,
                        token: receipt.token,
                        amount: receipt.amount,
                        ledger: receipt.ledger,
                        migrated: true,
                    };
                    let esc_key = DataKey::EscrowRecord(current_id);
                    env.storage().persistent().set(&esc_key, &escrow);
                    env.storage()
                        .persistent()
                        .extend_ttl(&esc_key, MIN_TTL, MAX_TTL);
                    migrated_count += 1;
                } else if let Some(receipt_v1) =
                    env.storage().persistent().get::<_, ReceiptV1>(&receipt_key)
                {
                    let fallback_token = env
                        .storage()
                        .instance()
                        .get(&DataKey::Token)
                        .unwrap_or_else(|| env.current_contract_address());
                    let escrow = EscrowRecord {
                        version: ESCROW_STORAGE_VERSION,
                        depositor: receipt_v1.depositor,
                        token: fallback_token,
                        amount: receipt_v1.amount,
                        ledger: receipt_v1.ledger,
                        migrated: true,
                    };
                    let esc_key = DataKey::EscrowRecord(current_id);
                    env.storage().persistent().set(&esc_key, &escrow);
                    env.storage()
                        .persistent()
                        .extend_ttl(&esc_key, MIN_TTL, MAX_TTL);
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

    /// Look up a migrated escrow position by its sequential deposit id.
    /// Returns None if not yet migrated or missing. Plain storage read (no auth required).
    pub fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord> {
        let esc_key = DataKey::EscrowRecord(id);
        let rec = env.storage().persistent().get(&esc_key);
        if rec.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&esc_key, MIN_TTL, MAX_TTL);
        }
        rec
    }

    /// Returns the current migration cursor position (how many receipts have been migrated).
    /// Plain storage read (no auth required). Defaults to 0 if not yet set.
    pub fn get_migration_cursor(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowMigrationCursor)
            .unwrap_or(0)
    }

    // ── Batched Admin Operations ──────────────────────────────────────────
    pub fn execute_batch_admin(
        env: Env,
        operations: Vec<BatchAdminOp>,
    ) -> Result<BatchResult, Error> {
        let admin = Self::require_admin(&env)?;

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
            let result = Self::execute_single_admin_op_internal(&env, &op, false);
            if result.is_err() {
                BatchFailEvent {
                    version: EVENT_VERSION,
                    index: idx as u32,
                    total_ops,
                }
                .publish(&env);
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

        BatchOkEvent {
            version: EVENT_VERSION,
            success_count,
            failure_count,
            total_ops,
        }
        .publish(&env);

        Ok(batch_result)
    }

    fn execute_single_admin_op(env: &Env, op: &BatchAdminOp) -> Result<(), Error> {
        Self::execute_single_admin_op_internal(env, op, false)
    }

    fn execute_single_admin_op_internal(
        env: &Env,
        op: &BatchAdminOp,
        is_multisig: bool,
    ) -> Result<(), Error> {
        let op_name = &op.op_type;

        if *op_name == Symbol::new(env, "set_cooldown") {
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::CooldownLedgers, &ledgers);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_lock") {
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            if ledgers > MAX_LOCK_PERIOD {
                return Err(Error::InvalidAmount);
            }
            let old_value: u32 = env
                .storage()
                .instance()
                .get(&DataKey::LockPeriod)
                .unwrap_or(0);
            env.storage().instance().set(&DataKey::LockPeriod, &ledgers);
            SetLockPeriodEvent {
                version: EVENT_VERSION,
                old: old_value,
                new: ledgers,
            }
            .publish(env);
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
            SlippageThresholdSetEvent {
                version: EVENT_VERSION,
                threshold_bps,
            }
            .publish(env);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_limit") {
            let (token, limit) = if let Ok(args) = SetLimitArgs::from_xdr(env, &op.payload) {
                (args.token, args.limit)
            } else if let Ok(tup) = <(Address, i128)>::from_xdr(env, &op.payload) {
                (tup.0, tup.1)
            } else {
                return Err(Error::InternalError);
            };

            if limit <= 0 {
                return Err(Error::ZeroAmount);
            }
            let max_cap: i128 = env
                .storage()
                .instance()
                .get(&DataKey::LimitMaxCap)
                .unwrap_or(i128::MAX);
            if limit > max_cap {
                return Err(Error::ExceedsLimitMaxCap);
            }
            let mut config: TokenConfig = env
                .storage()
                .persistent()
                .get(&DataKey::TokenRegistry(token.clone()))
                .ok_or(Error::TokenNotWhitelisted)?;
            config.limit = limit;
            let reg_key = DataKey::TokenRegistry(token.clone());
            env.storage().persistent().set(&reg_key, &config);
            env.storage()
                .persistent()
                .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);
            SetLimitEvent {
                version: EVENT_VERSION,
                token,
                limit,
                by: env.current_contract_address(),
                ledger: env.ledger().sequence(),
            }
            .publish(env);
            Ok(())
        } else if *op_name == Symbol::new(env, "pause") {
            env.storage().instance().set(&DataKey::Paused, &true);
            Ok(())
        } else if *op_name == Symbol::new(env, "unpause") {
            env.storage().instance().set(&DataKey::Paused, &false);
            Ok(())
        } else if *op_name == Symbol::new(env, "update_multisig") {
            // Executable ONLY through a multisig proposal
            if !is_multisig {
                return Err(Error::Unauthorized);
            }

            let (threshold, signers) =
                if let Ok(args) = UpdateMultisigArgs::from_xdr(env, &op.payload) {
                    (args.threshold, args.signers)
                } else if let Ok(tup) = <(u32, Vec<Address>)>::from_xdr(env, &op.payload) {
                    (tup.0, tup.1)
                } else {
                    return Err(Error::InternalError);
                };

            if signers.is_empty() {
                return Err(Error::InvalidThreshold);
            }
            if signers.len() > MAX_SIGNERS {
                return Err(Error::MaxSignersReached);
            }
            if threshold == 0 || threshold > signers.len() {
                return Err(Error::InvalidThreshold);
            }

            // Ensure no duplicate signers
            let mut seen = Vec::<Address>::new(env);
            for s in signers.iter() {
                if seen.contains(&s) {
                    return Err(Error::DuplicateSigner);
                }
                seen.push_back(s);
            }

            env.storage().instance().set(&DataKey::Signers, &signers);
            env.storage()
                .instance()
                .set(&DataKey::Threshold, &threshold);

            MultisigUpdatedEvent {
                version: EVENT_VERSION,
                signers,
                threshold,
            }
            .publish(env);

            Ok(())
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
    /// The breaker is evaluated across all withdrawal-producing flows that call
    /// [`Self::check_and_update_circuit_breaker`], including direct withdrawals,
    /// queued withdrawal requests, and queued withdrawal execution.
    ///
    /// - `threshold > 0`: enables the breaker and rejects the withdrawal that
    ///   would push the rolling total above the threshold.
    /// - `threshold == 0`: disables the breaker entirely.
    ///
    /// This value is stored under [`DataKey::CircuitBreakerThreshold`]. It does
    /// not itself reset an already-tripped breaker; use [`Self::reset_circuit_breaker`]
    /// for that operational action.
    pub fn set_circuit_breaker_threshold(env: Env, threshold: i128) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerThreshold, &threshold);
        Ok(())
    }

    /// Configure the auto-reset window for a tripped circuit breaker.
    ///
    /// The breaker stores the ledger at which it tripped in
    /// [`DataKey::CircuitBreakerTrippedAt`]. On the next guarded withdrawal or
    /// heartbeat path, the contract compares the current ledger against that
    /// trip point plus this reset window.
    ///
    /// - `0`: use the default 48-hour window [`CIRCUIT_BREAKER_RESET_LEDGERS`]
    /// - `u32::MAX`: disable auto-reset entirely
    /// - any other value: use that many ledgers as the reset window
    ///
    /// Auto-reset clears the tripped flag and rolls the global withdrawal window
    /// forward before the next guarded operation resumes.
    pub fn set_circuit_breaker_reset_window(env: Env, ledgers: u32) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
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
    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_circuit_breaker_reset_window(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerResetWindow)
            .unwrap_or(CIRCUIT_BREAKER_RESET_LEDGERS)
    }

    /// Manually clear the circuit breaker so guarded operations can resume.
    ///
    /// This admin-only action flips [`DataKey::CircuitBreakerTripped`] back to
    /// `false` and emits [`CircuitBreakerResetEvent`]. It is intended for manual
    /// recovery after operators have investigated the activity that caused the
    /// breaker to trip.
    ///
    /// This function does not change the configured threshold or reset window.
    pub fn reset_circuit_breaker(env: Env) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
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

    /// Return the currently configured rolling-volume threshold.
    ///
    /// A return value of `0` means the circuit breaker is disabled and no
    /// volume limit is enforced.  See [`Self::set_circuit_breaker_threshold`]
    /// for the full semantics.
    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_circuit_breaker_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerThreshold)
            .unwrap_or(0)
    }

    /// Return whether the circuit breaker is currently tripped (pure storage read).
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
        let admin = Self::require_admin(&env)?;

        // Reject admin as operator (role confusion guard)
        if operator == admin {
            return Err(Error::NotAllowed);
        }
        // Reject contract address as operator
        if operator == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
        }

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
        let _admin = Self::require_admin(&env)?;

        env.storage().instance().remove(&DataKey::WithdrawOperator);
        RemoveWithdrawOperatorEvent {
            version: EVENT_VERSION,
        }
        .publish(&env);
        Ok(())
    }

    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_withdraw_operator(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::WithdrawOperator)
    }

    // ── Issue #107: Governed upgrade mechanism ────────────────────────────

    pub fn set_upgrade_delay(env: Env, ledgers: u32) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        if ledgers < MIN_UPGRADE_DELAY {
            return Err(Error::UpgradeDelayTooShort);
        }
        env.storage()
            .instance()
            .set(&DataKey::UpgradeDelay, &ledgers);
        Ok(())
    }

    #[deprecated(note = "use get_config_snapshot instead")]
    pub fn get_upgrade_delay(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(MIN_UPGRADE_DELAY)
    }

    /// Proposes a contract WASM upgrade subject to a timelock delay.
    ///
    /// The delay is read from the stored [`DataKey::UpgradeDelay`] value
    /// (or [`MIN_UPGRADE_DELAY`] when none has been set).
    ///
    /// # Version Migration Guard (Issue #1003)
    /// `new_version` must be ≥ the currently stored contract version
    /// ([`DataKey::ContractVersion`]).  Proposing a `new_version` that is
    /// strictly *less* than the current version is rejected with
    /// [`Error::DowngradeNotAllowed`] to prevent accidental downgrades to
    /// an older storage schema.
    ///
    /// # Overflow Prevention & Safety Invariants
    /// - **Delay Bounds**: Validates `delay >= MIN_UPGRADE_DELAY`.
    /// - **Saturating Timelock Sequence**: Calculates
    ///   `executable_after = env.ledger().sequence().saturating_add(delay)`,
    ///   ensuring that sequence number calculations cannot overflow or bypass
    ///   the timelock.
    ///
    /// # Arguments
    /// * `env` – The Soroban host environment.
    /// * `new_wasm_hash` – 32-byte hash of the newly uploaded WASM binary.
    /// * `new_version` – Caller-declared version that the new WASM implements.
    ///   Must be ≥ the currently stored contract version.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] – If caller is not admin.
    /// * [`Error::DowngradeNotAllowed`] – If `new_version` < current stored version.
    pub fn propose_upgrade(
        env: Env,
        new_wasm_hash: BytesN<32>,
        new_version: u32,
    ) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;

        // ── Issue #1003: version migration guard ─────────────────────────
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(0u32);
        if new_version < current_version {
            return Err(Error::DowngradeNotAllowed);
        }

        // Read the configured upgrade delay (falls back to MIN_UPGRADE_DELAY)
        let delay: u32 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(MIN_UPGRADE_DELAY);

        // Prevent overflow when calculating executable_after
        let current_ledger = env.ledger().sequence();
        let executable_after = current_ledger.saturating_add(delay);

        let proposed_at = current_ledger;
        let proposal = UpgradeProposal {
            wasm_hash: new_wasm_hash.clone(),
            executable_after,
            new_version,
        };

        env.storage()
            .instance()
            .set(&DataKey::UpgradeProposal, &proposal);
        env.storage().instance().set(
            &DataKey::UpgradeProposalTiming,
            &UpgradeProposalTiming {
                wasm_hash: new_wasm_hash.clone(),
                proposed_at,
                delay,
                executable_after: proposal.executable_after,
            },
        );
        UpgradeProposedEvent {
            version: EVENT_VERSION,
            wasm_hash: new_wasm_hash,
            executable_after: proposal.executable_after,
        }
        .publish(&env);
        Ok(())
    }

    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(Error::UpgradeProposalMissing)?;

        if let Some(timing) = env
            .storage()
            .instance()
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

        // ── Issue #1003: bump the stored contract version ────────────────
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &proposal.new_version);

        env.storage().instance().remove(&DataKey::UpgradeProposal);
        env.storage()
            .instance()
            .remove(&DataKey::UpgradeProposalTiming);
        UpgradeExecutedEvent {
            version: EVENT_VERSION,
            wasm_hash: proposal.wasm_hash,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_upgrade(env: Env, nonce: u64) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;

        // Validate and increment nonce for replay protection
        let new_nonce = Self::consume_nonce(
            &env,
            DataKey::UpgradeCancellationNonce(admin.clone()),
            nonce,
        )?;

        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(Error::UpgradeProposalMissing)?;

        env.storage().instance().remove(&DataKey::UpgradeProposal);
        env.storage()
            .instance()
            .remove(&DataKey::UpgradeProposalTiming);
        UpgradeCancelledEvent {
            version: EVENT_VERSION,
            admin: admin.clone(),
            wasm_hash: proposal.wasm_hash.clone(),
            nonce: new_nonce,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&DataKey::UpgradeProposal)
    }

    /// Returns the currently stored contract version.
    ///
    /// The version starts at `0` after [`FiatBridge::init`] and is bumped to
    /// the `new_version` supplied to [`FiatBridge::propose_upgrade`] each time
    /// [`FiatBridge::execute_upgrade`] succeeds.  Callers can use this to
    /// confirm that a migration completed before relying on new storage layout.
    pub fn get_contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(0u32)
    }

    /// Return the ledger and delay recorded for the pending upgrade.
    pub fn get_upgrade_proposal_timing(env: Env) -> Option<UpgradeProposalTiming> {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeProposalTiming)
    }

    /// Add timing metadata to a proposal made by earlier contract versions.
    /// Its original execution deadline remains unchanged.
    pub fn migrate_upgrade_proposal_timing(env: Env) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        if env
            .storage()
            .instance()
            .has(&DataKey::UpgradeProposalTiming)
        {
            return Ok(());
        }
        if let Some(proposal) = env
            .storage()
            .instance()
            .get::<_, UpgradeProposal>(&DataKey::UpgradeProposal)
        {
            let delay = env
                .storage()
                .instance()
                .get(&DataKey::UpgradeDelay)
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

    pub fn propose_multisig_action(
        env: Env,
        proposer: Address,
        action: BatchAdminOp,
    ) -> Result<u64, Error> {
        proposer.require_auth();

        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .ok_or(Error::NotInitialized)?;
        if !signers.contains(&proposer) {
            return Err(Error::Unauthorized);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextMultisigID)
            .ok_or(Error::NotInitialized)?;
        let next_id = id.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::NextMultisigID, &next_id);

        let mut approvals = Vec::<Address>::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = MultisigProposal {
            creator: proposer.clone(),
            action,
            approvals,
            executed: false,
            created_at: env.ledger().sequence(),
        };

        let proposal_key = DataKey::MultisigProposal(id);
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage()
            .persistent()
            .extend_ttl(&proposal_key, MIN_TTL, MIN_TTL);

        MultisigProposedEvent {
            version: EVENT_VERSION,
            id,
            proposer,
        }
        .publish(&env);

        Ok(id)
    }

    pub fn approve_multisig_action(env: Env, signer: Address, id: u64) -> Result<(), Error> {
        signer.require_auth();

        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .ok_or(Error::NotInitialized)?;
        if !signers.contains(&signer) {
            return Err(Error::Unauthorized);
        }

        let proposal_key = DataKey::MultisigProposal(id);
        let mut proposal: MultisigProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        // Check expiry
        let current_ledger = env.ledger().sequence();
        if current_ledger
            .checked_sub(proposal.created_at)
            .is_none_or(|age| age > MULTISIG_PROPOSAL_EXPIRY)
        {
            return Err(Error::ProposalExpired);
        }

        if proposal.approvals.contains(&signer) {
            return Err(Error::AlreadyApproved);
        }

        proposal.approvals.push_back(signer.clone());
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage()
            .persistent()
            .extend_ttl(&proposal_key, MIN_TTL, MIN_TTL);

        MultisigApprovedEvent {
            version: EVENT_VERSION,
            id,
            signer,
        }
        .publish(&env);

        Ok(())
    }

    pub fn revoke_multisig_approval(env: Env, signer: Address, id: u64) -> Result<(), Error> {
        signer.require_auth();

        let proposal_key = DataKey::MultisigProposal(id);
        let mut proposal: MultisigProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        // Check expiry
        let current_ledger = env.ledger().sequence();
        if current_ledger
            .checked_sub(proposal.created_at)
            .is_none_or(|age| age > MULTISIG_PROPOSAL_EXPIRY)
        {
            return Err(Error::ProposalExpired);
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
                env.storage().persistent().set(&proposal_key, &proposal);
                env.storage()
                    .persistent()
                    .extend_ttl(&proposal_key, MIN_TTL, MIN_TTL);
                MultisigRevokedEvent {
                    version: EVENT_VERSION,
                    id,
                    signer,
                }
                .publish(&env);
                Ok(())
            }
            None => Err(Error::SignerNotFound),
        }
    }

    pub fn execute_multisig_action(env: Env, id: u64) -> Result<(), Error> {
        let proposal_key = DataKey::MultisigProposal(id);
        let proposal: MultisigProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        // Check expiry
        let current_ledger = env.ledger().sequence();
        if current_ledger
            .checked_sub(proposal.created_at)
            .is_none_or(|age| age > MULTISIG_PROPOSAL_EXPIRY)
        {
            return Err(Error::ProposalExpired);
        }

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .ok_or(Error::NotInitialized)?;

        let current_signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .ok_or(Error::NotInitialized)?;

        // Recount approvals dynamically against active signers
        let mut valid_approvals_count: u32 = 0;
        for a in proposal.approvals.iter() {
            if current_signers.contains(&a) {
                valid_approvals_count = valid_approvals_count.saturating_add(1);
            }
        }

        if valid_approvals_count < threshold {
            return Err(Error::ThresholdNotMet);
        }

        // Execute the action (with is_multisig = true)
        Self::execute_single_admin_op_internal(&env, &proposal.action, true)?;

        // Delete the proposal after successful execution
        env.storage().persistent().remove(&proposal_key);

        MultisigExecutedEvent {
            version: EVENT_VERSION,
            id,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_multisig_proposal(env: Env, id: u64) -> Option<MultisigProposal> {
        env.storage()
            .persistent()
            .get(&DataKey::MultisigProposal(id))
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

    /// Direct execution of multisig rotation is forbidden.
    /// Rotation can only occur through a matured multisig proposal.
    pub fn update_multisig(
        _env: Env,
        _signers: Vec<Address>,
        _threshold: u32,
    ) -> Result<(), Error> {
        Err(Error::Unauthorized)
    }

    pub fn build_update_multisig_op(
        env: &Env,
        signers: Vec<Address>,
        threshold: u32,
    ) -> BatchAdminOp {
        let args = UpdateMultisigArgs { threshold, signers };
        BatchAdminOp {
            op_type: Symbol::new(env, "update_multisig"),
            payload: args.to_xdr(env),
        }
    }

    pub fn build_set_limit_op(env: &Env, token: Address, limit: i128) -> BatchAdminOp {
        let args = SetLimitArgs { token, limit };
        BatchAdminOp {
            op_type: Symbol::new(env, "set_limit"),
            payload: args.to_xdr(env),
        }
    }

    // ── Missing methods referenced by tests ──────────────────────────────

    /// Set a hard cap on the maximum value that can be passed to `set_limit`.
    pub fn set_limit_max_cap(env: Env, cap: i128) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
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
        LimitMaxCapSetEvent {
            version: EVENT_VERSION,
            cap,
        }
        .publish(&env);
        Ok(())
    }

    /// Return the configured limit max cap (defaults to `i128::MAX`).
    pub fn get_set_limit_max_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::LimitMaxCap)
            .unwrap_or(i128::MAX)
    }

    /// Set a per-operator rolling 24h withdrawal limit.
    ///
    /// `limit` is denominated in the token's smallest unit (stroops for XLM)
    /// and is stored per `operator` under [`DataKey::OperatorDailyLimit`].
    /// `0` disables the limit; negative values are rejected with
    /// [`Error::InvalidAmount`]. Emits [`OperatorDailyLimitSetEvent`].
    ///
    /// Each [`withdraw`](FiatBridge::withdraw) made by the operator adds to a
    /// volume counter that resets `WINDOW_LEDGERS` (~24h) after the first
    /// withdrawal of the window. A withdrawal that would push the counter
    /// above `limit` fails with [`Error::OperatorDailyLimitExceeded`];
    /// reaching the limit exactly is allowed. The admin is not subject to it.
    pub fn set_operator_daily_limit(env: Env, operator: Address, limit: i128) -> Result<(), Error> {
        let _admin = Self::require_admin(&env)?;
        if limit < 0 {
            return Err(Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::OperatorDailyLimit(operator.clone()), &limit);
        OperatorDailyLimitSetEvent {
            version: EVENT_VERSION,
            operator,
            limit,
        }
        .publish(&env);
        Ok(())
    }

    /// Configure the emergency recovery address and an associated withdrawal cap.
    pub fn set_emergency_recovery(env: Env, recovery: Address, cap: i128) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        if cap <= 0 {
            return Err(Error::ZeroAmount);
        }
        if recovery == env.current_contract_address() {
            return Err(Error::InvalidRecipient);
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

    /// Return the configured emergency recovery address, if set.
    pub fn get_emergency_recovery_address(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyRecoveryAddress)
    }

    /// Trigger emergency recovery when the admin has been inactive for longer than InactivityThreshold.
    ///
    /// Moves at most EmergencyRecoveryCap to EmergencyRecoveryAddress and emits EmergencyRecoveryTriggeredEvent.
    pub fn trigger_emergency_recovery(env: Env) -> Result<(), Error> {
        let token = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;

        let recovery = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::EmergencyRecoveryAddress)
            .ok_or(Error::NoEmergencyRecoveryAddress)?;

        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::EmergencyRecoveryCap)
            .ok_or(Error::NoEmergencyRecoveryAddress)?;

        let last_admin_ledger: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LastAdminActionLedger)
            .unwrap_or(0);

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::InactivityThreshold)
            .unwrap_or(DEFAULT_INACTIVITY_THRESHOLD);

        let current_ledger = env.ledger().sequence();
        let elapsed = current_ledger.saturating_sub(last_admin_ledger);

        if elapsed < threshold {
            return Err(Error::InactivityThresholdNotReached);
        }

        Self::reject_if_denied(&env, &recovery)?;

        let token_client = token::Client::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());
        let transfer_amount = contract_balance.min(cap);

        if transfer_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &recovery, &transfer_amount);

            if let Some(mut config) = env
                .storage()
                .persistent()
                .get::<_, TokenConfig>(&DataKey::TokenRegistry(token.clone()))
            {
                config.total_withdrawn = config
                    .total_withdrawn
                    .checked_add(transfer_amount)
                    .ok_or(Error::InternalError)?;
                let reg_key = DataKey::TokenRegistry(token.clone());
                env.storage().persistent().set(&reg_key, &config);
                env.storage()
                    .persistent()
                    .extend_ttl(&reg_key, MIN_TTL, MAX_TTL);
            }
        }

        EmergencyRecoveryEvent {
            version: EVENT_VERSION,
            recovery,
            amount: transfer_amount,
            admin_last_active: last_admin_ledger,
            triggered_at: current_ledger,
        }
        .publish(&env);

        Ok(())
    }

    /// Return the pending admin transfer info `(new_admin, proposed_at_ledger)`, if any.
    pub fn get_pending_admin(env: Env) -> Option<(Address, u64)> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Return the current nonce for fee withdrawals (used for replay protection).
    pub fn get_fee_withdrawal_nonce(env: Env, caller: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::FeeWithdrawalNonceByCaller(caller))
            .unwrap_or(0)
    }

    /// Validate and increment the per-caller fee-withdrawal nonce. Used by
    /// both [`FiatBridge::withdraw_fees`] and [`FiatBridge::withdraw_fees_batch`],
    /// which therefore share one nonce sequence per caller.
    fn validate_and_increment_fee_withdrawal_nonce(
        env: &Env,
        caller: &Address,
        provided_nonce: u64,
    ) -> Result<(), Error> {
        let new_nonce = Self::consume_nonce(
            env,
            DataKey::FeeWithdrawalNonceByCaller(caller.clone()),
            provided_nonce,
        )?;

        NonceConsumedEvent {
            version: EVENT_VERSION,
            scope: Symbol::new(env, "fee_withdrawal"),
            owner: caller.clone(),
            new_nonce,
        }
        .publish(env);

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

    /// Deprecated alias for [`FiatBridge::get_fee_withdrawal_nonce`].
    ///
    /// `withdraw_fees_batch` has shared the single per-caller
    /// `FeeWithdrawalNonceByCaller` nonce with `withdraw_fees` since Issue
    /// #1113 (via [`FiatBridge::validate_and_increment_fee_withdrawal_nonce`]);
    /// there has never been a separate batch nonce. This entrypoint used to
    /// read the never-written `DataKey::FeeWithdrawalBatchNonce` key and
    /// always returned 0, which would desync any client that built a batch
    /// withdrawal transaction from it (see Issue #1420). Kept only so
    /// existing callers don't break; new integrations should call
    /// `get_fee_withdrawal_nonce` directly.
    #[deprecated(note = "use get_fee_withdrawal_nonce instead; there is no separate batch nonce")]
    pub fn get_fee_withdrawal_batch_nonce(env: Env, caller: Address) -> u64 {
        Self::get_fee_withdrawal_nonce(env, caller)
    }
}

#[cfg(test)]
mod test_view_function_snapshots;

#[cfg(any(test, feature = "testutils"))]
mod test;

#[cfg(test)]
mod test_oracle_staleness;
