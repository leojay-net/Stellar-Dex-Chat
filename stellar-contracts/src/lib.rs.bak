#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, Env, Symbol,
};

pub mod oracle;

// ── Constants ─────────────────────────────────────────────────────────────
pub const MIN_TTL: u32 = 518_400; // ~30 days
pub const MAX_TTL: u32 = 535_680; // ~31 days
const MAX_REFERENCE_LEN: u32 = 64;
const WINDOW_LEDGERS: u32 = 17_280; // ~24 hours
const WITHDRAWAL_EXPIRY_WINDOW_LEDGERS: u32 = 17_280; // ~24 hours
const MIN_TIMELOCK_DELAY: u32 = 34_560; // 48 hours
const DEFAULT_INACTIVITY_THRESHOLD: u32 = 1_555_200; // ~3 months

// ── Error codes ───────────────────────────────────────────────────────────
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ZeroAmount = 4,
    ExceedsLimit = 5,
    InsufficientFunds = 6,
    WithdrawalLocked = 7,
    RequestNotFound = 8,
    TokenNotWhitelisted = 9,
    ReferenceTooLong = 10,
    DailyLimitExceeded = 11,
    CooldownActive = 12,
    NotAllowed = 13,
    OracleNotSet = 14,
    ExceedsFiatLimit = 15,
    NoPendingAdmin = 16,
    ActionNotReady = 17,
    ActionNotQueued = 18,
    NoEmergencyRecoveryAddress = 19,
    InactivityThresholdNotReached = 20,
    InvalidRecipient = 21,
    WithdrawalExpired = 22,
    RequestNotExpired = 23,
}

// ── Models ────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawRequest {
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub unlock_ledger: u32,
    pub expires_ledger: u32,
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
pub struct UserDailyVolume {
    pub usd_cents: i128,
    pub window_start: u32,
}

// ── Storage keys ──────────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Token, // Default token
    TokenRegistry(Address),
    AllowlistEnabled,
    Allowed(Address),
    LastDeposit(Address),
    ReceiptCounter,
    Receipt(u64),
    LockPeriod,
    NextRequestID,
    WithdrawQueue(u64),
    DailyWithdrawLimit,
    WindowStart,
    WindowWithdrawn,
    CooldownLedgers,
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
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);

        env.storage().instance().set(&DataKey::SchemaVersion, &1u32);
        env.storage().instance().set(&DataKey::NextActionID, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::InactivityThreshold, &DEFAULT_INACTIVITY_THRESHOLD);

        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        Ok(())
    }

    pub fn deposit(
        env: Env,
        from: Address,
        amount: i128,
        token: Address,
        reference: Bytes,
    ) -> Result<u64, Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        from.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if reference.len() > MAX_REFERENCE_LEN {
            return Err(Error::ReferenceTooLong);
        }

        // Cooldown
        let cooldown: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CooldownLedgers)
            .unwrap_or(0);
        if cooldown > 0 {
            let key = DataKey::LastDeposit(from.clone());
            if let Some(last) = env.storage().temporary().get::<DataKey, u32>(&key) {
                if env.ledger().sequence() < last.saturating_add(cooldown) {
                    return Err(Error::CooldownActive);
                }
            }
            env.storage()
                .temporary()
                .set(&key, &env.ledger().sequence());
            env.storage().temporary().extend_ttl(&key, 5, 5);
        }

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

        // Registry & Limit
        let mut config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token.clone()))
            .ok_or(Error::TokenNotWhitelisted)?;
        if amount > config.limit {
            return Err(Error::ExceedsLimit);
        }

        // Fiat Limit
        Self::validate_fiat_limit(&env, &from, &token, amount)?;

        // Transfer
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // State update
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

        config.total_deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);

        let user_key = DataKey::UserDeposited(from.clone());
        let user_total: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&user_key, &(user_total + amount));

        env.events()
            .publish((Symbol::new(&env, "deposit"), from), amount);
        env.events()
            .publish((Symbol::new(&env, "rcpt_issd"),), receipt_id);

        Ok(receipt_id)
    }

    pub fn withdraw(env: Env, to: Address, amount: i128, token: Address) -> Result<(), Error> {
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
        let client = token::Client::new(&env, &token);
        if amount > client.balance(&env.current_contract_address()) {
            return Err(Error::InsufficientFunds);
        }
        client.transfer(&env.current_contract_address(), &to, &amount);
        env.events()
            .publish((Symbol::new(&env, "withdraw"), to), amount);
        Ok(())
    }

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
        let request_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestID)
            .unwrap_or(0);
        let unlock_ledger = env.ledger().sequence() + lock_period;

        let request = WithdrawRequest {
            to,
            token,
            amount,
            unlock_ledger,
            expires_ledger: unlock_ledger + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS,
        };
        env.storage()
            .persistent()
            .set(&DataKey::WithdrawQueue(request_id), &request);
        env.storage()
            .instance()
            .set(&DataKey::NextRequestID, &(request_id + 1));
        Ok(request_id)
    }

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
        if env.ledger().sequence() > request.expires_ledger {
            return Err(Error::WithdrawalExpired);
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

        if execute_amount > balance {
            return Err(Error::InsufficientFunds);
        }

        token_client.transfer(
            &env.current_contract_address(),
            &request.to,
            &execute_amount,
        );

        if execute_amount == request.amount {
            env.storage()
                .persistent()
                .remove(&DataKey::WithdrawQueue(request_id));
        } else {
            request.amount -= execute_amount;
            env.storage()
                .persistent()
                .set(&DataKey::WithdrawQueue(request_id), &request);
        }

        Ok(())
    }

    pub fn cancel_withdrawal(env: Env, request_id: u64) -> Result<(), Error> {
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

    pub fn reclaim_withdrawal(env: Env, request_id: u64) -> Result<(), Error> {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);

        let request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

        request.to.require_auth();

        if env.ledger().sequence() <= request.expires_ledger {
            return Err(Error::RequestNotExpired);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::WithdrawQueue(request_id));
        env.events().publish(
            (Symbol::new(&env, "withdraw_reclaimed"), request.to),
            request_id,
        );
        Ok(())
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

    fn validate_fiat_limit(
        env: &Env,
        depositor: &Address,
        token: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        let fiat_limit: i128 = match env.storage().instance().get(&DataKey::FiatLimit) {
            Some(l) => l,
            None => return Ok(()),
        };
        let oracle_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .ok_or(Error::OracleNotSet)?;
        let oracle = crate::oracle::OracleClient::new(env, &oracle_addr);
        let price = oracle.get_price(token).unwrap_or(0);
        if price <= 0 {
            return Err(Error::OracleNotSet);
        }

        let usd_cents = (amount * price) / (ORACLE_PRICE_DECIMALS / 100);
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
        if vol.usd_cents + usd_cents > fiat_limit {
            return Err(Error::ExceedsFiatLimit);
        }
        vol.usd_cents += usd_cents;
        env.storage()
            .instance()
            .set(&DataKey::UserDailyVolume(depositor.clone()), &vol);
        Ok(())
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
            action_type,
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
        env.storage()
            .instance()
            .set(&DataKey::LastAdminActionLedger, &env.ledger().sequence());
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
    pub fn get_limit(env: Env) -> i128 {
        let tok = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .unwrap();
        env.storage()
            .persistent()
            .get::<_, TokenConfig>(&DataKey::TokenRegistry(tok))
            .unwrap()
            .limit
    }
    pub fn get_user_deposited(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserDeposited(user))
            .unwrap_or(0)
    }
    pub fn get_total_deposited(env: Env) -> i128 {
        let tok = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Token)
            .unwrap();
        env.storage()
            .persistent()
            .get::<_, TokenConfig>(&DataKey::TokenRegistry(tok))
            .unwrap()
            .total_deposited
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
    pub fn get_withdrawal_request(env: Env, id: u64) -> Option<WithdrawRequest> {
        env.storage().persistent().get(&DataKey::WithdrawQueue(id))
    }
    pub fn get_last_deposit_ledger(env: Env, user: Address) -> Option<u32> {
        env.storage().temporary().get(&DataKey::LastDeposit(user))
    }
    pub fn get_withdrawal_expiry_window(env: Env) -> u32 {
        env.storage().instance().extend_ttl(MIN_TTL, MAX_TTL);
        WITHDRAWAL_EXPIRY_WINDOW_LEDGERS
    }
}

#[cfg(any(test, feature = "testutils"))]
mod test;
