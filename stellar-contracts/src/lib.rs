#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, Env, Symbol, Vec,
};

// ── Constants ─────────────────────────────────────────────────────────────
/// Minimum remaining ledgers for instance storage (~30 days)
pub const MIN_TTL: u32 = 518_400;

/// Maximum ledgers for instance storage TTL extension (~31 days)
pub const MAX_TTL: u32 = 535_680;

// ── Error codes ───────────────────────────────────────────────────────────
/// All error codes returned by FiatBridge contract functions.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The contract has not been initialised yet (`init` was never called).
    NotInitialized = 1,
    /// `init` has already been called; the contract cannot be initialised twice.
    AlreadyInitialized = 2,
    /// The caller does not have the required authorisation (e.g. not the admin).
    Unauthorized = 3,
    /// The supplied amount is zero or negative, which is not permitted.
    ZeroAmount = 4,
    /// The requested amount exceeds the per-deposit limit configured for the token.
    ExceedsLimit = 5,
    /// The contract does not hold enough tokens to satisfy the withdrawal.
    InsufficientFunds = 6,
    /// The withdrawal request has not yet reached its unlock ledger.
    WithdrawalLocked = 7,
    /// No withdrawal request exists with the supplied ID.
    RequestNotFound = 8,
    /// The supplied token address is not in the whitelist.
    TokenNotWhitelisted = 9,
    /// The deposit reference exceeds the maximum allowed byte length.
    ReferenceTooLong = 10,
    /// The sender attempted a deposit before their cooldown period has elapsed.
    CooldownActive = 11,
    /// `accept_admin` or `cancel_admin_transfer` was called when no pending admin exists.
    NoPendingAdmin = 12,
    ReceiptNotFound = 13,
    AlreadyRefunded = 14,
    ActionNotQueued = 15,
    ActionNotReady = 16,
    InactivityThresholdNotReached = 17,
    NoEmergencyRecoveryAddress = 18,
    /// The recipient address is invalid (e.g., contract address itself).
    InvalidRecipient = 19,
    /// Arithmetic overflow while updating cumulative totals.
    ArithmeticOverflow = 20,
}

// ── Models ────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawRequest {
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub unlock_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenConfig {
    pub limit: i128,
    pub total_deposited: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub id: u64,
    pub depositor: Address,
    pub amount: i128,
    pub ledger: u32,
    pub reference: Bytes,
    pub refunded: bool,
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
pub enum ReceiptStatus {
    Active,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawEntry {
    pub to: Address,
    pub amount: i128,
}

/// Maximum allowed length for a deposit reference (bytes).
const MAX_REFERENCE_LEN: u32 = 64;

// ── Storage keys ──────────────────────────────────────────────────────────
/// All persistent and instance storage keys used by FiatBridge.
#[contracttype]
pub enum DataKey {
    /// The current admin address.
    Admin,
    /// A nominated admin address that has not yet accepted the transfer.
    PendingAdmin,
    /// The default token address set during `init`.
    Token,
    /// Legacy key — superseded by `TokenRegistry`; kept for compatibility.
    BridgeLimit,
    /// Legacy key — superseded by `TokenRegistry`; kept for compatibility.
    TotalDeposited,
    /// Cumulative withdrawn amount across successful withdraw calls.
    TotalWithdrawn,
    /// Cumulative amount deposited by a specific user address.
    UserDeposited(Address),
    /// Mandatory lock period (in ledgers) for queued withdrawal requests.
    LockPeriod,
    /// A pending withdrawal request identified by its sequential ID.
    WithdrawQueue(u64),
    /// Auto-incrementing counter used to generate withdrawal request IDs.
    NextRequestID,
    /// Per-token configuration (`TokenConfig`) keyed by token address.
    TokenRegistry(Address),
    /// Auto-incrementing counter used to generate deposit receipt IDs.
    ReceiptCounter,
    /// A deposit receipt identified by its sequential ID.
    Receipt(u64),
    /// Optional daily withdrawal cap enforced across the rolling 24 h window.
    DailyWithdrawLimit,
    /// Minimum ledger gap required between successive deposits from the same address.
    DepositCooldown,
    /// Ledger sequence of the last deposit made by a specific address.
    LastDepositLedger(Address),
    /// Contract schema version for safe migrations. Always bump on breaking storage changes.
    SchemaVersion,

    // ── Added for admin actions and recovery ──
    /// Auto-incrementing counter for admin actions
    NextActionID,
    /// Last ledger when an admin action was performed
    LastAdminActionLedger,
    /// Inactivity threshold for admin recovery
    InactivityThreshold,
    /// Queued admin action by action ID
    QueuedAdminAction(u64),
    /// Emergency recovery address
    EmergencyRecoveryAddress,
}

/// Approximate number of ledgers in a 24-hour window (5-second close time).
const WINDOW_LEDGERS: u32 = 17_280;

/// Minimum timelock delay for admin actions (48 hours in ledgers).
const MIN_TIMELOCK_DELAY: u32 = 34_560;

/// Default inactivity threshold for emergency recovery (3 months in ledgers).
const DEFAULT_INACTIVITY_THRESHOLD: u32 = 1_555_200;

// ── Contract ──────────────────────────────────────────────────────────────
#[contract]
pub struct FiatBridge;

#[contractimpl]
impl FiatBridge {
    fn increment_total_withdrawn(env: &Env, amount: i128) -> Result<i128, Error> {
        let total_withdrawn: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalWithdrawn)
            .unwrap_or(0);
        let updated_total = total_withdrawn
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        env.storage()
            .instance()
            .set(&DataKey::TotalWithdrawn, &updated_total);
        Ok(updated_total)
    }

    /// Allow a third-party payer to deposit tokens on behalf of a beneficiary.
    /// All checks and per-user tracking apply to the beneficiary.
    /// Returns the unique receipt ID on success.
    pub fn deposit_for(
        env: Env,
        payer: Address,
        beneficiary: Address,
        amount: i128,
        token: Address,
        reference: Bytes,
    ) -> Result<u64, Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        payer.require_auth();

        // ── Cooldown check (applies to beneficiary) ───────────────
        let cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DepositCooldown)
            .unwrap_or(0);
        if cooldown > 0 {
            let last_key = DataKey::LastDepositLedger(beneficiary.clone());
            if let Some(last_ledger) = env.storage().instance().get::<DataKey, u32>(&last_key) {
                if env.ledger().sequence() - last_ledger < cooldown {
                    return Err(Error::CooldownActive);
                }
            }
        }

        if reference.len() > MAX_REFERENCE_LEN {
            return Err(Error::ReferenceTooLong);
        }
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;

        if amount > config.limit {
            return Err(Error::ExceedsLimit);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&payer, env.current_contract_address(), &amount);

        // ── Create deposit receipt (beneficiary is credited) ──────
        let receipt_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);
        let receipt = Receipt {
            id: receipt_id,
            depositor: beneficiary.clone(),
            amount,
            ledger: env.ledger().sequence(),
            reference,
            refunded: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Receipt(receipt_id), &receipt);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptCounter, &(receipt_id + 1));

        // ── Update per-token totals ───────────────────────────────
        config.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        let user_key = DataKey::UserDeposited(beneficiary.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&user_key, &(user_total + amount));
        // ── Events ────────────────────────────────────────────────
        // Emit deposit_for event
        env.events().publish(
            (Symbol::new(&env, "dep_for"),),
            (payer.clone(), beneficiary.clone(), amount),
        );

        // Emit receipt issued event
        env.events()
            .publish((Symbol::new(&env, "rcpt_issd"),), (receipt_id, amount));

        // ── Record last deposit ledger for cooldown (beneficiary) ─
        if cooldown > 0 {
            env.storage().instance().set(
                &DataKey::LastDepositLedger(beneficiary),
                &env.ledger().sequence(),
            );
        }

        Ok(receipt_id)
    }
    /// Emergency admin-only function to drain all held funds to a recipient in one atomic operation.
    pub fn emergency_drain(env: Env, recipient: Address) -> Result<(), Error> {
        // Only admin can call
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let contract_addr = env.current_contract_address();
        if recipient == contract_addr {
            return Err(Error::InvalidRecipient);
        }

        // Use default token
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_id);
        let balance = token_client.balance(&contract_addr);
        if balance <= 0 {
            return Err(Error::ZeroAmount);
        }

        token_client.transfer(&contract_addr, &recipient, &balance);
        let total_withdrawn = Self::increment_total_withdrawn(&env, balance)?;

        env.events().publish(
            (Symbol::new(&env, "emg_drain"), recipient.clone()),
            (balance, total_withdrawn),
        );

        Ok(())
    }
    /// Initialise the bridge once. Sets admin and registers the first whitelisted token.
    pub fn init(env: Env, admin: Address, token: Address, limit: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::TotalWithdrawn, &0_i128);
        let config = TokenConfig {
            limit,
            total_deposited: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);

        // Set schema version to 1 on initialization
        env.storage().instance().set(&DataKey::SchemaVersion, &1u32);
        env.storage().instance().set(&DataKey::NextActionID, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::InactivityThreshold, &DEFAULT_INACTIVITY_THRESHOLD);
        Ok(())
    }
    /// Returns the current contract schema version (for migrations).
    /// Defaults to 1 if not present (for backward compatibility).
    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(1u32)
    }

    /// Admin-only migration entrypoint. Applies pending migrations and bumps schema version.
    ///
    /// Convention: Each breaking storage change must bump the schema version and add a branch here.
    ///
    /// Example:
    ///   match version {
    ///     1 => { /* migrate to 2 */ env.storage().instance().set(&DataKey::SchemaVersion, &2u32); },
    ///     2 => { /* migrate to 3 */ ... },
    ///     _ => {}
    ///   }
    pub fn migrate(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let version = env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(1u32);

        match version {
            1 => {
                // No migrations pending for version 1 → 1
                // Add future migrations here as new branches
                Ok(())
            }
            // _ => Ok(()), // For future versions
            _ => Ok(()),
        }
    }

    /// Lock tokens inside the bridge and issue a deposit receipt.
    /// The token must be registered in the whitelist.
    /// Returns the unique receipt ID on success.
    pub fn deposit(
        env: Env,
        from: Address,
        amount: i128,
        token: Address,
        reference: Bytes,
    ) -> Result<u64, Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        from.require_auth();

        // ── Cooldown check ────────────────────────────────────────────
        let cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DepositCooldown)
            .unwrap_or(0);
        if cooldown > 0 {
            let last_key = DataKey::LastDepositLedger(from.clone());
            if let Some(last_ledger) = env.storage().instance().get::<DataKey, u32>(&last_key) {
                if env.ledger().sequence() - last_ledger < cooldown {
                    return Err(Error::CooldownActive);
                }
            }
        }

        if reference.len() > MAX_REFERENCE_LEN {
            return Err(Error::ReferenceTooLong);
        }
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;

        if amount > config.limit {
            return Err(Error::ExceedsLimit);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, env.current_contract_address(), &amount);

        // ── Create deposit receipt ────────────────────────────────────
        let receipt_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);
        let receipt = Receipt {
            id: receipt_id,
            depositor: from.clone(),
            amount,
            ledger: env.ledger().sequence(),
            reference,
            refunded: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Receipt(receipt_id), &receipt);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptCounter, &(receipt_id + 1));

        // ── Update per-token totals ───────────────────────────────────
        config.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        let user_key = DataKey::UserDeposited(from.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&user_key, &(user_total + amount));
        // ── Events ────────────────────────────────────────────────────
        env.events()
            .publish((Symbol::new(&env, "deposit"), from.clone()), amount);
        env.events()
            .publish((Symbol::new(&env, "rcpt_issd"),), receipt_id);

        // ── Record last deposit ledger for cooldown ─────────────────────
        if cooldown > 0 {
            env.storage()
                .instance()
                .set(&DataKey::LastDepositLedger(from), &env.ledger().sequence());
        }

        Ok(receipt_id)
    }

    /// Withdraw tokens from the bridge. Caller must authorise.
    /// No whitelist check — allows draining balances of removed tokens.
    pub fn withdraw(env: Env, to: Address, amount: i128, token: Address) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        to.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let token_client = token::Client::new(&env, &token);
        let contract_addr = env.current_contract_address();
        let balance = token_client.balance(&contract_addr);
        if amount > balance {
            return Err(Error::InsufficientFunds);
        }
        token_client.transfer(&contract_addr, &to, &amount);
        let total_withdrawn = Self::increment_total_withdrawn(&env, amount)?;

        env.events()
            .publish((Symbol::new(&env, "withdraw"), to), (amount, total_withdrawn));

        Ok(())
    }

    /// Register a withdrawal request that matures after the lock period. Admin only.
    pub fn request_withdrawal(
        env: Env,
        to: Address,
        amount: i128,
        token: Address,
    ) -> Result<u64, Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let lock_period: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0);
        let unlock_ledger = env.ledger().sequence() + lock_period;

        let request_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestID)
            .unwrap_or(0);

        let request = WithdrawRequest {
            to,
            token,
            amount,
            unlock_ledger,
        };

        env.storage()
            .persistent()
            .set(&DataKey::WithdrawQueue(request_id), &request);
        env.storage()
            .instance()
            .set(&DataKey::NextRequestID, &(request_id + 1));

        Ok(request_id)
    }

    /// Execute a matured withdrawal request. Supports partial execution.
    pub fn execute_withdrawal(
        env: Env,
        request_id: u64,
        partial_amount: Option<i128>,
    ) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let mut request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

        if env.ledger().sequence() < request.unlock_ledger {
            return Err(Error::WithdrawalLocked);
        }

        let token_client = token::Client::new(&env, &request.token);
        let contract_addr = env.current_contract_address();
        let balance = token_client.balance(&contract_addr);
        let execute_amount = match partial_amount {
            Some(amount) => {
                if amount <= 0 || amount > request.amount {
                    return Err(Error::ZeroAmount);
                }
                if amount > balance {
                    return Err(Error::InsufficientFunds);
                }
                amount
            }
            None => {
                if request.amount > balance {
                    return Err(Error::InsufficientFunds);
                }
                request.amount
            }
        };

        token_client.transfer(&contract_addr, &request.to, &execute_amount);
        let total_withdrawn = Self::increment_total_withdrawn(&env, execute_amount)?;

        if partial_amount.is_some() {
            let remaining = request.amount - execute_amount;

            if remaining <= 0 {
                env.storage()
                    .persistent()
                    .remove(&DataKey::WithdrawQueue(request_id));
            } else {
                request.amount = remaining;
                env.storage()
                    .persistent()
                    .set(&DataKey::WithdrawQueue(request_id), &request);
            }

            env.events().publish(
                (Symbol::new(&env, "partial_withdrawal_executed"), request_id),
                (execute_amount, remaining, total_withdrawn),
            );
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::WithdrawQueue(request_id));
            env.events().publish(
                (Symbol::new(&env, "withdrawal_executed"), request_id),
                (execute_amount, total_withdrawn),
            );
        }

        Ok(())
    }

    /// Cancel a pending withdrawal request. Admin only.
    pub fn cancel_withdrawal(env: Env, request_id: u64) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if !env
            .storage()
            .persistent()
            .has(&DataKey::WithdrawQueue(request_id))
        {
            return Err(Error::RequestNotFound);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::WithdrawQueue(request_id));
        Ok(())
    }

    /// Refund a deposit receipt to the original depositor. Admin only.
    /// Used when off-chain fiat payout fails (KYC, invalid details, etc.).
    pub fn refund_deposit(env: Env, receipt_id: u64) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let mut receipt: Receipt = env
            .storage()
            .persistent()
            .get(&DataKey::Receipt(receipt_id))
            .ok_or(Error::ReceiptNotFound)?;

        if receipt.refunded {
            return Err(Error::AlreadyRefunded);
        }

        let token_client = token::Client::new(
            &env,
            &env.storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(Error::NotInitialized)?,
        );

        token_client.transfer(
            &env.current_contract_address(),
            &receipt.depositor,
            &receipt.amount,
        );
        let total_withdrawn = Self::increment_total_withdrawn(&env, receipt.amount)?;

        receipt.refunded = true;
        env.storage()
            .persistent()
            .set(&DataKey::Receipt(receipt_id), &receipt);

        Self::update_last_admin_action_ledger(&env);

        env.events().publish(
            (Symbol::new(&env, "refund"), receipt_id),
            (receipt.depositor.clone(), receipt.amount, total_withdrawn),
        );

        Ok(())
    }

    /// Set the maximum tokens that may be withdrawn within a rolling 24-hour window
    /// (~17 280 ledgers). Setting to 0 disables the daily cap. Admin only.
    pub fn set_daily_limit(env: Env, limit: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if limit < 0 {
            return Err(Error::ZeroAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::DailyWithdrawLimit, &limit);
        Ok(())
    }

    /// Set the mandatory delay period for withdrawals (in ledgers). Admin only.
    pub fn set_lock_period(env: Env, ledgers: u32) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::LockPeriod, &ledgers);
        Ok(())
    }

    /// Update the per-deposit limit for a specific token. Admin only.
    pub fn set_limit(env: Env, token: Address, new_limit: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        if new_limit <= 0 {
            return Err(Error::ZeroAmount);
        }
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
        config.limit = new_limit;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);
        Ok(())
    }

    /// Hand admin rights to a new address. Current admin must authorise.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        // Nominate a pending admin rather than immediately replacing the active admin
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);

        // Emit event for off-chain indexing/observability
        env.events()
            .publish((Symbol::new(&env, "admin_nominated"),), new_admin.clone());

        Ok(())
    }

    /// Accept a previously nominated admin. The nominated address must call this
    /// to finalize the transfer. Until this is called the existing admin remains active.
    pub fn accept_admin(env: Env, claimant: Address) -> Result<(), Error> {
        // Read pending admin
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;

        // Only the pending admin may finalize the transfer. If the provided
        // claimant does not match the pending address, return Unauthorized.
        if claimant != pending {
            return Err(Error::Unauthorized);
        }

        // Ensure the claimant authorises this action (they must control the key)
        claimant.require_auth();

        // Move pending into active admin and clear pending
        env.storage().instance().set(&DataKey::Admin, &claimant);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events()
            .publish((Symbol::new(&env, "admin_accepted"),), claimant.clone());

        Ok(())
    }

    /// Cancel a pending admin nomination. Admin only.
    pub fn cancel_admin_transfer(env: Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if !env.storage().instance().has(&DataKey::PendingAdmin) {
            return Err(Error::NoPendingAdmin);
        }

        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .unwrap();

        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (Symbol::new(&env, "admin_transfer_cancelled"),),
            pending.clone(),
        );

        Ok(())
    }

    // ── Admin timelock management ───────────────────────────────────────

    /// Queue an admin action for delayed execution. Admin only.
    pub fn queue_admin_action(
        env: Env,
        action_type: Symbol,
        payload: Bytes,
        delay_ledgers: u32,
    ) -> Result<u64, Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if delay_ledgers < MIN_TIMELOCK_DELAY {
            return Err(Error::ActionNotReady);
        }

        let current_ledger = env.ledger().sequence();
        let action_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextActionID)
            .unwrap_or(0);

        let action = QueuedAdminAction {
            action_type: action_type.clone(),
            payload: payload.clone(),
            target_ledger: current_ledger + delay_ledgers,
            queued_ledger: current_ledger,
        };

        env.storage()
            .persistent()
            .set(&DataKey::QueuedAdminAction(action_id), &action);
        env.storage()
            .instance()
            .set(&DataKey::NextActionID, &(action_id + 1));

        env.events().publish(
            (Symbol::new(&env, "action_queued"), action_id),
            (action_type, delay_ledgers),
        );

        Ok(action_id)
    }

    /// Execute a queued admin action. Admin only.
    pub fn execute_admin_action(env: Env, action_id: u64) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let action: QueuedAdminAction = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(action_id))
            .ok_or(Error::ActionNotQueued)?;

        let current_ledger = env.ledger().sequence();
        if current_ledger <= action.target_ledger {
            return Err(Error::ActionNotReady);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::QueuedAdminAction(action_id));

        Self::update_last_admin_action_ledger(&env);

        env.events().publish(
            (Symbol::new(&env, "action_executed"), action_id),
            action.action_type.clone(),
        );

        Ok(())
    }

    /// Cancel a queued admin action. Admin only.
    pub fn cancel_admin_action(env: Env, action_id: u64) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let action: QueuedAdminAction = env
            .storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(action_id))
            .ok_or(Error::ActionNotQueued)?;

        env.storage()
            .persistent()
            .remove(&DataKey::QueuedAdminAction(action_id));

        env.events().publish(
            (Symbol::new(&env, "action_cancelled"), action_id),
            action.action_type.clone(),
        );

        Ok(())
    }

    /// Set emergency recovery address. Admin only.
    pub fn set_emergency_recovery_address(env: Env, address: Address) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::EmergencyRecoveryAddress, &address);
        Self::update_last_admin_action_ledger(&env);
        Ok(())
    }

    /// Set inactivity threshold for emergency recovery. Admin only.
    pub fn set_inactivity_threshold(env: Env, threshold_ledgers: u32) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::InactivityThreshold, &threshold_ledgers);
        Self::update_last_admin_action_ledger(&env);
        Ok(())
    }

    /// Claim admin role using emergency recovery. Only callable after inactivity period.
    pub fn claim_admin(env: Env) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);

        let recovery_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::EmergencyRecoveryAddress)
            .ok_or(Error::NoEmergencyRecoveryAddress)?;
        recovery_address.require_auth();

        let last_action_ledger: u32 = env
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
        if current_ledger <= last_action_ledger + threshold {
            return Err(Error::InactivityThresholdNotReached);
        }

        env.storage()
            .instance()
            .set(&DataKey::Admin, &recovery_address);
        env.storage()
            .instance()
            .remove(&DataKey::EmergencyRecoveryAddress);

        env.events().publish(
            (Symbol::new(&env, "admin_claimed"),),
            recovery_address.clone(),
        );

        Ok(())
    }

    // ── Token registry management (admin-only) ───────────────────────────

    /// Add a new token to the whitelist. Admin only.
    pub fn add_token(env: Env, token: Address, limit: i128) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        if limit <= 0 {
            return Err(Error::ZeroAmount);
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let config = TokenConfig {
            limit,
            total_deposited: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        env.events()
            .publish((Symbol::new(&env, "token_added"),), token);
        Ok(())
    }

    /// Remove a token from the whitelist. Admin only.
    /// Does not affect existing balances — admin can still drain remaining tokens.
    pub fn remove_token(env: Env, token: Address) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if !env
            .storage()
            .persistent()
            .has(&DataKey::TokenRegistry(token.clone()))
        {
            return Err(Error::TokenNotWhitelisted);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::TokenRegistry(token.clone()));

        env.events()
            .publish((Symbol::new(&env, "token_removed"),), token);
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────
    /// Returns the current admin address.
    ///
    /// # Errors
    /// - [`Error::NotInitialized`] if `init` has not been called.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Returns the currently nominated (pending) admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Returns the default (init) token address.
    pub fn get_token(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }

    /// Per-deposit limit for the default (init) token.
    pub fn get_limit(env: Env) -> Result<i128, Error> {
        let tok: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(tok))
            .ok_or(Error::NotInitialized)?;
        Ok(config.limit)
    }

    /// Current balance of the default (init) token held by this contract.
    pub fn get_balance(env: Env) -> Result<i128, Error> {
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        Ok(token::Client::new(&env, &token_id).balance(&env.current_contract_address()))
    }

    /// Cumulative deposit total for the default (init) token.
    pub fn get_total_deposited(env: Env) -> Result<i128, Error> {
        let tok: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(tok))
            .ok_or(Error::NotInitialized)?;
        Ok(config.total_deposited)
    }

    /// Cumulative withdrawal total tracked by successful `withdraw` calls.
    pub fn get_total_withdrawn(env: Env) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::TotalWithdrawn)
            .unwrap_or(0))
    }
    /// Running total of historical deposits for a specific user.
    ///
    /// Returns `0` if the user has never deposited.
    ///
    /// # Errors
    /// - [`Error::NotInitialized`] if `init` has not been called.
    pub fn get_user_deposited(env: Env, user: Address) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::UserDeposited(user))
            .unwrap_or(0))
    }

    /// Get details of a pending withdrawal request by its ID.
    ///
    /// Returns `None` if the request has already been executed or cancelled.
    pub fn get_withdrawal_request(env: Env, request_id: u64) -> Option<WithdrawRequest> {
        env.storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
    }

    /// Get the current lock period in ledgers.
    pub fn get_lock_period(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::LockPeriod)
            .unwrap_or(0)
    }

    /// Look up a token's configuration (limit and cumulative deposits).
    pub fn get_token_config(env: Env, token: Address) -> Option<TokenConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token))
    }

    // ── Receipt view functions ─────────────────────────────────────────

    /// Look up a deposit receipt by its ID.
    ///
    /// Returns `None` if no receipt exists for the given ID.
    pub fn get_receipt(env: Env, id: u64) -> Option<Receipt> {
        env.storage().persistent().get(&DataKey::Receipt(id))
    }

    /// Paginated lookup of receipts belonging to `depositor`.
    ///
    /// Scans receipt IDs starting at `from_id` and returns up to `limit`
    /// matching receipts.
    pub fn get_receipts_by_depositor(
        env: Env,
        depositor: Address,
        from_id: u64,
        limit: u32,
    ) -> Vec<Receipt> {
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0);
        let mut results: Vec<Receipt> = Vec::new(&env);
        let mut found: u32 = 0;
        let mut id = from_id;

        while id < counter && found < limit {
            if let Some(receipt) = env
                .storage()
                .persistent()
                .get::<DataKey, Receipt>(&DataKey::Receipt(id))
            {
                if receipt.depositor == depositor {
                    results.push_back(receipt);
                    found += 1;
                }
            }
            id += 1;
        }

        results
    }

    /// Get the current receipt counter (total number of receipts ever issued).
    pub fn get_receipt_counter(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0)
    }

    /// Get a queued admin action by ID.
    pub fn get_queued_admin_action(env: Env, action_id: u64) -> Option<QueuedAdminAction> {
        env.storage()
            .persistent()
            .get(&DataKey::QueuedAdminAction(action_id))
    }

    /// Get the emergency recovery address.
    pub fn get_emergency_recovery_address(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyRecoveryAddress)
    }

    /// Get the last admin action ledger.
    pub fn get_last_admin_action_ledger(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::LastAdminActionLedger)
            .unwrap_or(0)
    }

    /// Get the inactivity threshold.
    pub fn get_inactivity_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::InactivityThreshold)
            .unwrap_or(DEFAULT_INACTIVITY_THRESHOLD)
    }

    // ── Cooldown functions ─────────────────────────────────────────────

    /// Set the per-address deposit cooldown period (in ledgers). Admin only.
    pub fn set_cooldown(env: Env, ledgers: u32) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::DepositCooldown, &ledgers);
        Ok(())
    }

    /// Get the current per-address deposit cooldown period (in ledgers).
    pub fn get_cooldown(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DepositCooldown)
            .unwrap_or(0)
    }

    /// Get the ledger sequence of a user's last deposit, if within the cooldown window.
    pub fn get_last_deposit_ledger(env: Env, user: Address) -> Option<u32> {
        let cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DepositCooldown)
            .unwrap_or(0);
        if cooldown == 0 {
            return None;
        }
        env.storage()
            .instance()
            .get(&DataKey::LastDepositLedger(user))
            .filter(|&ledger| env.ledger().sequence() - ledger < cooldown)
    }

    fn update_last_admin_action_ledger(env: &Env) {
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
    }
}

#[cfg(any(test, feature = "testutils"))]
mod test;
