#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, Env, Symbol, Vec,
};

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
}

// ── Models ────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawRequest {
    pub to: Address,
    pub token: Address,
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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawEntry {
    pub to: Address,
    pub amount: i128,
}

/// Maximum allowed length for a deposit reference (bytes).
const MAX_REFERENCE_LEN: u32 = 64;

/// Maximum number of entries allowed in a single batch withdrawal.
const MAX_BATCH_SIZE: u32 = 25;

// ── Storage keys ──────────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    BridgeLimit,
    TotalDeposited,
    UserDeposited(Address),
    LockPeriod,
    WithdrawQueue(u64),
    NextRequestID,
    TokenRegistry(Address),
    TokenRegistry(Address),
    ReceiptCounter,
    Receipt(u64),
}

/// Approximate number of ledgers in a 24-hour window (5-second close time).
const WINDOW_LEDGERS: u32 = 17_280;

// ── Contract ──────────────────────────────────────────────────────────────
#[contract]
pub struct FiatBridge;

#[contractimpl]
impl FiatBridge {
    /// Initialise the bridge once. Sets admin and registers the first whitelisted token.
    /// Initialise the bridge once. Sets admin and registers the first whitelisted token.
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
        let config = TokenConfig {
            limit,
            total_deposited: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token), &config);
        Ok(())
    }

    /// Lock tokens inside the bridge and issue a deposit receipt.
    /// The token must be registered in the whitelist.
    /// The token must be registered in the whitelist.
    /// Returns the unique receipt ID on success.
    pub fn deposit(
        env: Env,
        from: Address,
        amount: i128,
        token: Address,
        token: Address,
        reference: Bytes,
    ) -> Result<u64, Error> {
        from.require_auth();

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

        token::Client::new(&env, &token).transfer(

        token::Client::new(&env, &token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

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
        };
        env.storage()
            .persistent()
            .set(&DataKey::Receipt(receipt_id), &receipt);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptCounter, &(receipt_id + 1));

        // ── Update per-token totals ───────────────────────────────────
        config.total_deposited += amount;
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
            .publish((Symbol::new(&env, "deposit"), from), amount);
        env.events()
            .publish((Symbol::new(&env, "receipt_issued"),), receipt_id);

        Ok(())
    }

    /// Withdraw tokens from the bridge. Caller must authorise.
    /// No whitelist check — allows draining balances of removed tokens.
    pub fn withdraw(env: Env, to: Address, amount: i128, token: Address) -> Result<(), Error> {
        to.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let token_client = token::Client::new(&env, &token);
        let token_client = token::Client::new(&env, &token);

        let balance = token_client.balance(&env.current_contract_address());
        if amount > balance {
            return Err(Error::InsufficientFunds);
        }

        token_client.transfer(&env.current_contract_address(), &to, &amount);

        env.events()
            .publish((Symbol::new(&env, "withdraw"), to), amount);

        Ok(())
    }

    /// Register a withdrawal request that matures after the lock period. Admin only.
    pub fn request_withdrawal(
        env: Env,
        to: Address,
        amount: i128,
        token: Address,
    ) -> Result<u64, Error> {
    pub fn request_withdrawal(
        env: Env,
        to: Address,
        amount: i128,
        token: Address,
    ) -> Result<u64, Error> {
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

    /// Execute a matured withdrawal request.
    pub fn execute_withdrawal(env: Env, request_id: u64) -> Result<(), Error> {
        let request: WithdrawRequest = env
            .storage()
            .persistent()
            .get(&DataKey::WithdrawQueue(request_id))
            .ok_or(Error::RequestNotFound)?;

        if env.ledger().sequence() < request.unlock_ledger {
            return Err(Error::WithdrawalLocked);
        }

        let token_client = token::Client::new(&env, &request.token);

        let balance = token_client.balance(&env.current_contract_address());
        if request.amount > balance {
            return Err(Error::InsufficientFunds);
        }

        token_client.transfer(
            &env.current_contract_address(),
            &request.to,
            &request.amount,
        );

        env.storage()
            .persistent()
            .remove(&DataKey::WithdrawQueue(request_id));

        Ok(())
    }

    /// Cancel a pending withdrawal request. Admin only.
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

    /// Set the maximum tokens that may be withdrawn within a rolling 24-hour window
    /// (~17 280 ledgers). Setting to 0 disables the daily cap. Admin only.
    pub fn set_daily_limit(env: Env, limit: i128) -> Result<(), Error> {
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
    /// Update the per-deposit limit for a specific token. Admin only.
    pub fn set_limit(env: Env, token: Address, new_limit: i128) -> Result<(), Error> {
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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // ── Token registry management (admin-only) ───────────────────────────

    /// Add a new token to the whitelist. Admin only.
    pub fn add_token(env: Env, token: Address, limit: i128) -> Result<(), Error> {
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
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Returns the default (init) token address.

    /// Returns the default (init) token address.
    pub fn get_token(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }

    /// Per-deposit limit for the default (init) token.

    /// Per-deposit limit for the default (init) token.
    pub fn get_limit(env: Env) -> Result<i128, Error> {
        let tok: Address = env
            .storage()
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

    /// Cumulative deposit total for the default (init) token.
    pub fn get_total_deposited(env: Env) -> Result<i128, Error> {
        let tok: Address = env
            .storage()
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
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let config: TokenConfig = env
            .storage()
            .persistent()
            .get(&DataKey::TokenRegistry(tok))
            .ok_or(Error::NotInitialized)?;
        Ok(config.total_deposited)
    }
    /// Running total of historical deposits for a specific user.
    pub fn get_user_deposited(env: Env, user: Address) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::UserDeposited(user))
            .unwrap_or(0))


    /// Get details of a withdrawal request.
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

    /// Get the current receipt counter (total number of receipts issued).
    pub fn get_receipt_counter(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ReceiptCounter)
            .unwrap_or(0)
    }
}

mod test;
