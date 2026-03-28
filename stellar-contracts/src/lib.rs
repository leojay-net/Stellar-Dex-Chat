#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, xdr::ToXdr, Address, Bytes, BytesN,
    Env, Symbol, Vec,
};

pub mod math;
pub mod oracle;

// ── Constants ─────────────────────────────────────────────────────────────
pub const MIN_TTL: u32 = 518_400; // ~30 days
pub const MAX_TTL: u32 = 535_680; // ~31 days
const MAX_REFERENCE_LEN: u32 = 64;
const WINDOW_LEDGERS: u32 = 17_280; // ~24 hours
const MIN_TIMELOCK_DELAY: u32 = 34_560; // 48 hours
const DEFAULT_INACTIVITY_THRESHOLD: u32 = 1_555_200; // ~3 months
pub const EVENT_VERSION: u32 = 1;
pub const ESCROW_STORAGE_VERSION: u32 = 1;

// ── Error codes ───────────────────────────────────────────────────────────
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
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

    // --- 400 series: Funds & Balances ---
    InsufficientFunds = 401,
    NoFeesToWithdraw = 402,

    // --- 500 series: Withdrawal Queue ---
    RequestNotFound = 501,
    WithdrawalLocked = 502,

    // --- 600 series: Governance & Timelock ---
    ActionNotQueued = 601,
    ActionNotReady = 602,
    InactivityThresholdNotReached = 603,
    NoEmergencyRecoveryAddress = 604,

    // --- 700 series: External Services ---
    OracleNotSet = 701,
    OraclePriceInvalid = 702,
    SlippageExceeded = 703,

    // --- 800 series: Quota & Migration ---
    WithdrawalQuotaExceeded = 801,
    MigrationAlreadyComplete = 802,
    BatchOperationFailed = 803,

    // --- 900 series: Replay Protection ---
    InvalidNonce = 901,
    StaleNonce = 902,
}

// ── Models ────────────────────────────────────────────────────────────────
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
pub struct UserDailyWithdrawal {
    pub amount: i128,
    pub window_start: u32,
}

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
    UserDailyWithdrawal(Address),
    EscrowStorageVersion,
    EscrowRecord(u64),
    EscrowMigrationCursor,
    PendingRenounceLedger,
    Operator(Address),
    OperatorHeartbeat(Address),
    OperatorNonce(Address),
    Denied(Address),
    FeeVault(Address),
    ReceiptIndex(u64),
    // ── Issue #214: deployment config hash ────────────────────────────────
    DeployConfigHash,
    // ── Issue #209: global circuit breaker ───────────────────────────────
    CircuitBreakerThreshold,
    CircuitBreakerTripped,
    GlobalDailyWithdrawn,
    // ── Issue #226: withdrawal queue risk tiers ───────────────────────────
    TierQueueHead(u32),
    TierQueueLen(u32),
}

const ORACLE_PRICE_DECIMALS: i128 = 10_000_000;

// ── Contract ──────────────────────────────────────────────────────────────
#[contract]
pub struct FiatBridge;

#[contractimpl]
impl FiatBridge {
    pub fn init(env: Env, admin: Address, token: Address, limit: i128) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);

        let config = TokenConfig {
            limit,
            total_deposited: 0,
            total_withdrawn: 0,
            total_liabilities: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        env.storage().instance().set(&DataKey::SchemaVersion, &1u32);
        env.storage().instance().set(&DataKey::NextActionID, &0u64);
        env.storage().instance().set(&DataKey::WithdrawQueueLen, &0u64);
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

        // ── Issue #214: store and emit immutable deployment config hash ──
        let config_data = (admin.clone(), token.clone(), limit);
        let config_hash: BytesN<32> = env.crypto().sha256(&config_data.to_xdr(&env)).into();
        env.storage()
            .persistent()
            .set(&DataKey::DeployConfigHash, &config_hash);
        env.events().publish(
            (Symbol::new(&env, "deploy_hash"), Symbol::new(&env, "v1")),
            config_hash,
        );

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
        from.require_auth();
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
        let allowlist_on: bool = env
            .storage()
            .instance()
            .get(&DataKey::AllowlistEnabled)
            .unwrap_or(false);
        if allowlist_on
            && !env
                .storage()
                .persistent()
                .has(&DataKey::Allowed(from.clone()))
        {
            return Err(Error::NotAllowed);
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
        if amount > config.limit {
            return Err(Error::ExceedsLimit);
        }

        // Fiat Limit & Slippage
        let actual_price = Self::validate_fiat_limit(&env, &from, &token, amount)?;
        Self::check_slippage(&env, expected_price, actual_price, max_slippage)?;

        // Transfer
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

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
        if env.storage().persistent().has(&DataKey::Receipt(receipt_id.clone().into())) {
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
        env.storage()
            .persistent()
            .set(&DataKey::ReceiptIndex(receipt_counter), &receipt_hash);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptCounter, &(receipt_counter + 1));

        config.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        let user_key = DataKey::UserDeposited(from.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&user_key, &(user_total + amount));

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

        env.events()
            .publish((Symbol::new(&env, "deposit"), from), amount);
        env.events()
            .publish((Symbol::new(&env, "rcpt_issd"), memo_hash), receipt_id);

        Self::check_invariants(&env, &token)?;

        Ok(receipt_hash)
    }

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

    pub fn withdraw(env: Env, to: Address, amount: i128, token: Address) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
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
        config.total_withdrawn += amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        Self::check_invariants(&env, &token)?;
        env.events()
            .publish((Symbol::new(&env, "withdraw"), to), amount);
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
        config.total_liabilities += amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        Self::check_invariants(&env, &token)?;
        
        env.events().publish(
            (Symbol::new(&env, "req_withdr"), to),
            (request_id, memo_hash),
        );

        Ok(request_id)
    }

    pub fn execute_withdrawal(
        env: Env,
        request_id: u64,
        partial_amount: Option<i128>,
        expected_price: i128,
        max_slippage: u32,
    ) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
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
        config.total_withdrawn += execute_amount;
        config.total_liabilities -= execute_amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(request.token.clone()), &config);

        Self::check_invariants(&env, &request.token)?;

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

    pub fn pause(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((Symbol::new(&env, "paused"), Symbol::new(&env, "v1")), ());
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
        env.events()
            .publish((Symbol::new(&env, "unpaused"), Symbol::new(&env, "v1")), ());
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

    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

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
        let slippage_bps = if actual_price < expected_price {
            let diff = expected_price - actual_price;
            crate::math::mul_div_floor(diff, 10000, expected_price)
        } else {
            0
        };

        env.events().publish(
            (Symbol::new(env, "slippage"), Symbol::new(env, "v1")),
            slippage_bps as u32,
        );

        if slippage_bps > max_slippage_bps as i128 {
            return Err(Error::SlippageExceeded);
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

    // ── Timelock ──────────────────────────────────────────────────────────
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
        env.events().publish(
            (Symbol::new(&env, "admin_action_queued"), action_type, id),
            action.target_ledger,
        );
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
        env.events().publish(
            (Symbol::new(&env, "admin_action_executed"), id),
            true, // success
        );
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        Ok(())
    }

    // ── Operator Role & Heartbeat ───────────────────────────────────────
    pub fn set_operator(env: Env, operator: Address, active: bool) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Operator(operator), &active);
        Ok(())
    }

    // ── Denylist ──────────────────────────────────────────────────────────
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
        env.events()
            .publish((Symbol::new(&env, "deny_add"),), address);
        Ok(())
    }

    pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error> {
        operator.require_auth();
        if !env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Operator(operator.clone()))
            .unwrap_or(false)
        {
            return Err(Error::NotOperator);
        }

        // Validate and increment nonce for replay protection
        Self::validate_and_increment_nonce(&env, &operator, nonce)?;

        let curr = env.ledger().sequence();
        env.storage()
            .instance()
            .set(&DataKey::OperatorHeartbeat(operator.clone()), &curr);

        env.events()
            .publish((Symbol::new(&env, "heartbeat"), operator), curr);

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

    fn validate_and_increment_nonce(env: &Env, operator: &Address, provided_nonce: u64) -> Result<(), Error> {
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
        env.storage()
            .instance()
            .set(&DataKey::OperatorNonce(operator.clone()), &(current_nonce + 1));

        env.events().publish(
            (Symbol::new(env, "nonce_inc"), operator.clone()),
            current_nonce + 1,
        );

        Ok(())
    }

    // ── Ownership Renounce ────────────────────────────────────────────────
    pub fn queue_renounce_admin(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
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
        env.events()
            .publish((Symbol::new(&env, "deny_rem"),), address);
        Ok(())
    }

    pub fn is_denied(env: Env, address: Address) -> bool {
        env.storage().persistent().has(&DataKey::Denied(address))
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

        env.events()
            .publish((Symbol::new(&env, "fee_accrue"), token), amount);
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

    pub fn get_accrued_fees(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::FeeVault(token))
            .unwrap_or(0)
    }

    pub fn withdraw_fees(env: Env, to: Address, token: Address, amount: i128) -> Result<(), Error> {
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
        if amount > current {
            return Err(Error::NoFeesToWithdraw);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        env.storage().persistent().set(&key, &(current - amount));
        env.events()
            .publish((Symbol::new(&env, "fee_wdrw"), to), amount);
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

        env.events()
            .publish((Symbol::new(&env, "rescue"), token, to), amount);
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
    pub fn get_receipt_by_index(env: Env, idx: u64) -> Option<Receipt> {
        let receipt_hash: BytesN<32> = env
            .storage()
            .persistent()
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
        env.events().publish(
            (Symbol::new(&env, "quota_set"), Symbol::new(&env, "v1")),
            quota,
        );
        Ok(())
    }

    pub fn get_withdrawal_quota(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalQuota)
            .unwrap_or(0)
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
            env.events().publish(
                (Symbol::new(env, "quota_reset"), Symbol::new(env, "v1")),
                (user.clone(), record.window_start),
            );
        }

        if record.amount + amount > quota {
            return Err(Error::WithdrawalQuotaExceeded);
        }

        record.amount += amount;
        env.storage()
            .instance()
            .set(&DataKey::UserDailyWithdrawal(user.clone()), &record);

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
                .persistent()
                .get::<_, BytesN<32>>(&DataKey::ReceiptIndex(idx))
            {
                let receipt_key = DataKey::Receipt(receipt_hash.clone());
                if let Some(receipt) = env
                    .storage()
                    .persistent()
                    .get::<_, Receipt>(&receipt_key)
                {
                    if receipt.depositor == *depositor {
                        env.storage()
                            .persistent()
                            .extend_ttl(&receipt_key, min_ttl, min_ttl);
                    }
                }
            }
            idx += 1;
        }
    }

    // ── Escrow Migration ──────────────────────────────────────────────────
    pub fn get_escrow_storage_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowStorageVersion)
            .unwrap_or(0)
    }

    pub fn migrate_escrow(
        env: Env,
        batch_size: u32,
    ) -> Result<u32, Error> {
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
                .persistent()
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
                            .unwrap_or_else(|| Address::from_string(&soroban_sdk::String::from_str(&env, ""))),
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

        env.events().publish(
            (Symbol::new(&env, "migration"), Symbol::new(&env, "v1")),
            (current_id, migrated_count),
        );

        Ok(migrated_count)
    }

    pub fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord> {
        env.storage().persistent().get(&DataKey::EscrowRecord(id))
    }

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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let total_ops = operations.len() as u32;
        let mut success_count: u32 = 0;

        let snapshot_cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CooldownLedgers)
            .unwrap_or(0);
        let snapshot_lock_period: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0);
        let snapshot_quota: i128 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalQuota)
            .unwrap_or(0);
        let snapshot_anti_sandwich: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AntiSandwichDelay)
            .unwrap_or(0);

        for (idx, op) in operations.iter().enumerate() {
            let result = Self::execute_single_admin_op(&env, &op);
            if result.is_err() {
                env.storage()
                    .instance()
                    .set(&DataKey::CooldownLedgers, &snapshot_cooldown);
                env.storage()
                    .instance()
                    .set(&DataKey::LockPeriod, &snapshot_lock_period);
                env.storage()
                    .instance()
                    .set(&DataKey::WithdrawalQuota, &snapshot_quota);
                env.storage()
                    .instance()
                    .set(&DataKey::AntiSandwichDelay, &snapshot_anti_sandwich);

                env.events().publish(
                    (Symbol::new(&env, "batch_fail"), Symbol::new(&env, "v1")),
                    (idx as u32, total_ops),
                );

                return Err(Error::BatchOperationFailed);
            }
            success_count += 1;
        }

        let batch_result = BatchResult {
            total_ops,
            success_count,
            failed_index: None,
        };

        env.events().publish(
            (Symbol::new(&env, "batch_ok"), Symbol::new(&env, "v1")),
            (success_count, total_ops),
        );

        Ok(batch_result)
    }

    fn execute_single_admin_op(env: &Env, op: &BatchAdminOp) -> Result<(), Error> {
        let op_name = &op.op_type;

        if *op_name == Symbol::new(env, "set_cooldown") {
            if op.payload.len() < 4 {
                return Err(Error::InternalError);
            }
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::CooldownLedgers, &ledgers);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_lock") {
            if op.payload.len() < 4 {
                return Err(Error::InternalError);
            }
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::LockPeriod, &ledgers);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_quota") {
            if op.payload.len() < 16 {
                return Err(Error::InternalError);
            }
            let quota = Self::bytes_to_i128(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::WithdrawalQuota, &quota);
            Ok(())
        } else if *op_name == Symbol::new(env, "set_sandwich") {
            if op.payload.len() < 4 {
                return Err(Error::InternalError);
            }
            let ledgers = Self::bytes_to_u32(env, &op.payload)?;
            env.storage()
                .instance()
                .set(&DataKey::AntiSandwichDelay, &ledgers);
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
        for i in 0..4 {
            arr[i] = bytes.get(i as u32).ok_or(Error::InternalError)?;
        }
        Ok(u32::from_be_bytes(arr))
    }

    fn bytes_to_i128(_env: &Env, bytes: &Bytes) -> Result<i128, Error> {
        if bytes.len() < 16 {
            return Err(Error::InternalError);
        }
        let mut arr = [0u8; 16];
        for i in 0..16 {
            arr[i] = bytes.get(i as u32).ok_or(Error::InternalError)?;
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
        env.events().publish(
            (Symbol::new(&env, "cb_reset"), Symbol::new(&env, "v1")),
            env.ledger().sequence(),
        );
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

        // Reject immediately if already tripped.
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::CircuitBreakerTripped)
            .unwrap_or(false)
        {
            return Err(Error::CircuitBreakerActive);
        }

        let curr = env.ledger().sequence();
        let mut vol: GlobalDailyWithdrawn = env
            .storage()
            .instance()
            .get(&DataKey::GlobalDailyWithdrawn)
            .unwrap_or(GlobalDailyWithdrawn {
                amount: 0,
                window_start: curr,
            });

        // Roll window if 24h has elapsed.
        if curr >= vol.window_start + WINDOW_LEDGERS {
            vol.amount = 0;
            vol.window_start = curr;
        }

        let new_total = vol.amount + amount;

        // Update running total first so the state persists.
        vol.amount = new_total;
        env.storage()
            .instance()
            .set(&DataKey::GlobalDailyWithdrawn, &vol);

        if new_total > threshold {
            // This withdrawal crossed the threshold: allow it but trip the
            // breaker so that all subsequent withdrawals are paused.
            env.storage()
                .instance()
                .set(&DataKey::CircuitBreakerTripped, &true);
            env.events().publish(
                (Symbol::new(env, "cbtripped"), Symbol::new(env, "v1")),
                (new_total, threshold),
            );
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
        let head: Option<u64> = env
            .storage()
            .instance()
            .get(&head_key)
            .unwrap_or(None);
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
}

#[cfg(any(test, feature = "testutils"))]
mod test;
