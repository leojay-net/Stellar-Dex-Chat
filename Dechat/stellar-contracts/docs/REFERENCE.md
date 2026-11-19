# FiatBridge Soroban Contract Function Reference

This document provides a comprehensive, function-by-function reference for the `FiatBridge` Soroban smart contract (`Dechat/stellar-contracts/src/lib.rs`).

The `FiatBridge` contract manages escrow deposits, risk-tiered and timelocked withdrawal queues, oracle price and slippage verification, multi-token registries, operator health heartbeats, timelocked contract upgrades, and multisig governance.

---

## Table of Contents

- [1. Deposits (10)](#1-deposits)
  - [`deposit`](#deposit)
  - [`set_min_deposit`](#set_min_deposit)
  - [`get_min_deposit`](#get_min_deposit)
  - [`set_daily_deposit_limit`](#set_daily_deposit_limit)
  - [`get_user_lifetime_deposited`](#get_user_lifetime_deposited)
  - [`get_user_deposited`](#get_user_deposited)
  - [`get_daily_deposit_record`](#get_daily_deposit_record)
  - [`get_total_deposited`](#get_total_deposited)
  - [`get_receipt_by_index`](#get_receipt_by_index)
  - [`get_last_deposit_ledger`](#get_last_deposit_ledger)
- [2. Withdrawals (20)](#2-withdrawals)
  - [`withdraw`](#withdraw)
  - [`request_withdrawal`](#request_withdrawal)
  - [`execute_withdrawal`](#execute_withdrawal)
  - [`cancel_withdrawal`](#cancel_withdrawal)
  - [`reclaim_expired_withdrawal`](#reclaim_expired_withdrawal)
  - [`set_withdrawal_cooldown`](#set_withdrawal_cooldown)
  - [`get_withdrawal_cooldown`](#get_withdrawal_cooldown)
  - [`get_withdrawal_threshold`](#get_withdrawal_threshold)
  - [`get_withdrawal_request`](#get_withdrawal_request)
  - [`get_wq_depth`](#get_wq_depth)
  - [`get_wq_oldest_queued_ledger`](#get_wq_oldest_queued_ledger)
  - [`get_wq_oldest_age_ledgers`](#get_wq_oldest_age_ledgers)
  - [`get_total_withdrawn`](#get_total_withdrawn)
  - [`set_withdrawal_quota`](#set_withdrawal_quota)
  - [`get_withdrawal_quota`](#get_withdrawal_quota)
  - [`set_withdrawal_expiry`](#set_withdrawal_expiry)
  - [`get_withdrawal_expiry`](#get_withdrawal_expiry)
  - [`get_user_daily_withdrawal`](#get_user_daily_withdrawal)
  - [`get_next_priority_withdrawal`](#get_next_priority_withdrawal)
  - [`get_withdrawal_execution_nonce`](#get_withdrawal_execution_nonce)
- [3. Administration (66)](#3-administration)
  - [`init`](#init)
  - [`get_init_nonce`](#get_init_nonce)
  - [`get_set_limit_nonce`](#get_set_limit_nonce)
  - [`set_limit`](#set_limit)
  - [`register_token`](#register_token)
  - [`get_token_config`](#get_token_config)
  - [`set_token_allowlist_enabled`](#set_token_allowlist_enabled)
  - [`add_token_allowlist`](#add_token_allowlist)
  - [`remove_token_allowlist`](#remove_token_allowlist)
  - [`set_cooldown`](#set_cooldown)
  - [`set_lock_period`](#set_lock_period)
  - [`pause`](#pause)
  - [`unpause`](#unpause)
  - [`batch_unpause`](#batch_unpause)
  - [`set_anti_sandwich_delay`](#set_anti_sandwich_delay)
  - [`transfer_admin`](#transfer_admin)
  - [`accept_admin`](#accept_admin)
  - [`set_oracle`](#set_oracle)
  - [`set_fiat_limit`](#set_fiat_limit)
  - [`queue_admin_action`](#queue_admin_action)
  - [`execute_admin_action`](#execute_admin_action)
  - [`cancel_admin_action`](#cancel_admin_action)
  - [`get_queued_admin_action`](#get_queued_admin_action)
  - [`set_inactivity_threshold`](#set_inactivity_threshold)
  - [`get_inactivity_threshold`](#get_inactivity_threshold)
  - [`get_last_admin_action_ledger`](#get_last_admin_action_ledger)
  - [`deny_address`](#deny_address)
  - [`queue_renounce_admin`](#queue_renounce_admin)
  - [`remove_denied_address`](#remove_denied_address)
  - [`is_denied`](#is_denied)
  - [`get_denied_addresses`](#get_denied_addresses)
  - [`get_token_allowlist`](#get_token_allowlist)
  - [`get_token_allowlist_enabled`](#get_token_allowlist_enabled)
  - [`accrue_fee`](#accrue_fee)
  - [`cancel_renounce_admin`](#cancel_renounce_admin)
  - [`get_accrued_fees`](#get_accrued_fees)
  - [`get_accrued_fees_authenticated`](#get_accrued_fees_authenticated)
  - [`withdraw_fees`](#withdraw_fees)
  - [`withdraw_fees_batch`](#withdraw_fees_batch)
  - [`execute_renounce_admin`](#execute_renounce_admin)
  - [`rescue_token`](#rescue_token)
  - [`get_admin`](#get_admin)
  - [`get_token`](#get_token)
  - [`get_limit`](#get_limit)
  - [`get_user_available_balance`](#get_user_available_balance)
  - [`get_lock_period`](#get_lock_period)
  - [`get_cooldown`](#get_cooldown)
  - [`get_slippage_threshold`](#get_slippage_threshold)
  - [`set_slippage_threshold`](#set_slippage_threshold)
  - [`set_fee_recipient`](#set_fee_recipient)
  - [`clear_fee_recipient`](#clear_fee_recipient)
  - [`get_fee_recipient`](#get_fee_recipient)
  - [`get_pending_renounce_ledger`](#get_pending_renounce_ledger)
  - [`get_anti_sandwich_delay`](#get_anti_sandwich_delay)
  - [`get_total_liabilities`](#get_total_liabilities)
  - [`get_config_snapshot`](#get_config_snapshot)
  - [`execute_batch_admin`](#execute_batch_admin)
  - [`get_event_version`](#get_event_version)
  - [`get_deploy_config_hash`](#get_deploy_config_hash)
  - [`get_contract_version`](#get_contract_version)
  - [`build_set_limit_op`](#build_set_limit_op)
  - [`set_limit_max_cap`](#set_limit_max_cap)
  - [`get_set_limit_max_cap`](#get_set_limit_max_cap)
  - [`get_pending_admin`](#get_pending_admin)
  - [`get_fee_withdrawal_nonce`](#get_fee_withdrawal_nonce)
  - [`get_fee_withdrawal_batch_nonce`](#get_fee_withdrawal_batch_nonce)
- [4. Operators (13)](#4-operators)
  - [`set_operator`](#set_operator)
  - [`set_max_operators`](#set_max_operators)
  - [`get_set_operator_nonce`](#get_set_operator_nonce)
  - [`heartbeat`](#heartbeat)
  - [`heartbeat_batch`](#heartbeat_batch)
  - [`is_operator`](#is_operator)
  - [`get_operator_heartbeat`](#get_operator_heartbeat)
  - [`get_operator_nonce`](#get_operator_nonce)
  - [`prune_inactive_operators`](#prune_inactive_operators)
  - [`set_withdraw_operator`](#set_withdraw_operator)
  - [`remove_withdraw_operator`](#remove_withdraw_operator)
  - [`get_withdraw_operator`](#get_withdraw_operator)
  - [`set_operator_daily_limit`](#set_operator_daily_limit)
- [5. Upgrades (14)](#5-upgrades)
  - [`get_escrow_storage_version`](#get_escrow_storage_version)
  - [`migrate_escrow`](#migrate_escrow)
  - [`get_escrow_record`](#get_escrow_record)
  - [`get_migration_cursor`](#get_migration_cursor)
  - [`set_migration_cursor`](#set_migration_cursor)
  - [`set_upgrade_delay`](#set_upgrade_delay)
  - [`get_upgrade_delay`](#get_upgrade_delay)
  - [`propose_upgrade`](#propose_upgrade)
  - [`execute_upgrade`](#execute_upgrade)
  - [`cancel_upgrade`](#cancel_upgrade)
  - [`get_upgrade_proposal`](#get_upgrade_proposal)
  - [`get_upgrade_proposal_timing`](#get_upgrade_proposal_timing)
  - [`migrate_upgrade_proposal_timing`](#migrate_upgrade_proposal_timing)
  - [`get_upgrade_cancellation_nonce`](#get_upgrade_cancellation_nonce)
- [6. Multisig (9)](#6-multisig)
  - [`propose_multisig_action`](#propose_multisig_action)
  - [`approve_multisig_action`](#approve_multisig_action)
  - [`revoke_multisig_approval`](#revoke_multisig_approval)
  - [`execute_multisig_action`](#execute_multisig_action)
  - [`get_multisig_proposal`](#get_multisig_proposal)
  - [`get_multisig_signers`](#get_multisig_signers)
  - [`get_multisig_threshold`](#get_multisig_threshold)
  - [`update_multisig`](#update_multisig)
  - [`build_update_multisig_op`](#build_update_multisig_op)
- [7. Emergency Operations (10)](#7-emergency-operations)
  - [`set_circuit_breaker_threshold`](#set_circuit_breaker_threshold)
  - [`set_circuit_breaker_reset_window`](#set_circuit_breaker_reset_window)
  - [`get_circuit_breaker_reset_window`](#get_circuit_breaker_reset_window)
  - [`reset_circuit_breaker`](#reset_circuit_breaker)
  - [`get_circuit_breaker_threshold`](#get_circuit_breaker_threshold)
  - [`is_circuit_breaker_tripped`](#is_circuit_breaker_tripped)
  - [`set_emergency_recovery`](#set_emergency_recovery)
  - [`get_emergency_recovery_cap`](#get_emergency_recovery_cap)
  - [`get_emergency_recovery_address`](#get_emergency_recovery_address)
  - [`trigger_emergency_recovery`](#trigger_emergency_recovery)

---

## 1. Deposits

### `deposit`

```rust
pub fn deposit(env: Env, from: Address, amount: i128, token: Address, reference: Bytes, expected_price: i128, max_slippage: u32, memo_hash: Option<BytesN<32>>,) -> Result<BytesN<32>, Error>
```

**Purpose**: Deposits tokens into the bridge vault, minting a cryptographic receipt and updating accumulators.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `from` | `Address` | Input parameter `from` of type `Address`. |
| `amount` | `i128` | Input parameter `amount` of type `i128`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `reference` | `Bytes` | Input parameter `reference` of type `Bytes`. |
| `expected_price` | `i128` | Input parameter `expected_price` of type `i128`. |
| `max_slippage` | `u32` | Input parameter `max_slippage` of type `u32`. |
| `memo_hash` | `Option<BytesN<32>>` | Input parameter `memo_hash` of type `Option<BytesN<32>>`. |

**Return Value**: `Result<BytesN<32>, Error>`

**Authentication & Authorization**: Depositor (`from.require_auth()`)

**Relevant Error Conditions**:
`Error::BelowMinimum`, `Error::CooldownActive`, `Error::ExceedsLimit`, `Error::InternalError`, `Error::NotAllowed`, `Error::Overflow`, `Error::ReferenceTooLong`, `Error::TokenNotWhitelisted`, `Error::ZeroAmount`

**Events Emitted**:
`DepositEvent`, `ReceiptIssuedEvent`, `receipt_id`

**Storage Effects**: Instance storage updated, Persistent storage entry written, Temporary storage written

**Associated Test File**: [`src/test_admin_auth_deposit.rs`](../src/test_admin_auth_deposit.rs)

---

### `set_min_deposit`

```rust
pub fn set_min_deposit(env: Env, min: i128) -> Result<(), Error>
```

**Purpose**: ── Issue #113: minimum deposit floor ────────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `min` | `i128` | Input parameter `min` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::BelowMinimum`

**Events Emitted**:
`SetMinDepositEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_min_deposit`

```rust
pub fn get_min_deposit(env: Env) -> i128
```

**Purpose**: Executes `get_min_deposit` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_daily_deposit_limit`

```rust
pub fn set_daily_deposit_limit(env: Env, token: Address, limit_per_day: i128,) -> Result<(), Error>
```

**Purpose**: Executes `set_daily_deposit_limit` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `limit_per_day` | `i128` | Input parameter `limit_per_day` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ExceedsLimit`, `Error::TokenNotWhitelisted`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_user_lifetime_deposited`

```rust
pub fn get_user_lifetime_deposited(env: Env, user: Address) -> i128
```

**Purpose**: Returns the lifetime total deposits for a user across all tokens. This is a historical aggregate and does not reflect available balance. Use `get_user_available_balance` for the actual withdrawable amount per token.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_user_deposited`

```rust
pub fn get_user_deposited(env: Env, user: Address) -> i128
```

**Purpose**: Deprecated: use `get_user_lifetime_deposited` for clarity. This method is kept for backward compatibility but returns the lifetime total, not the available balance.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_token_allowlist_invariants.rs`](../src/test_token_allowlist_invariants.rs)

---

### `get_daily_deposit_record`

```rust
pub fn get_daily_deposit_record(env: Env, user: Address) -> Option<UserDailyVolume>
```

**Purpose**: Executes `get_daily_deposit_record` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |

**Return Value**: `Option<UserDailyVolume>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_total_deposited`

```rust
pub fn get_total_deposited(env: Env) -> i128
```

**Purpose**: Executes `get_total_deposited` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_receipt_by_index`

```rust
pub fn get_receipt_by_index(env: Env, idx: u64) -> Option<Receipt>
```

**Purpose**: Executes `get_receipt_by_index` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `idx` | `u64` | Input parameter `idx` of type `u64`. |

**Return Value**: `Option<Receipt>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_get_receipt_by_index.rs`](../src/test_get_receipt_by_index.rs)

---

### `get_last_deposit_ledger`

```rust
pub fn get_last_deposit_ledger(env: Env, user: Address) -> Option<u32>
```

**Purpose**: Executes `get_last_deposit_ledger` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |

**Return Value**: `Option<u32>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

## 2. Withdrawals

### `withdraw`

```rust
pub fn withdraw(env: Env, caller: Address, to: Address, amount: i128, token: Address,) -> Result<(), Error>
```

**Purpose**: Directly processes an authorized withdrawal from the contract to a recipient address.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Input parameter `caller` of type `Address`. |
| `to` | `Address` | Input parameter `to` of type `Address`. |
| `amount` | `i128` | Input parameter `amount` of type `i128`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Caller (`caller.require_auth()`)

**Relevant Error Conditions**:
`Error::InsufficientFunds`, `Error::InternalError`, `Error::InvalidRecipient`, `Error::NotInitialized`, `Error::TokenNotWhitelisted`, `Error::Unauthorized`, `Error::ZeroAmount`

**Events Emitted**:
`WithdrawEvent`

**Storage Effects**: Persistent storage entry written

**Associated Test File**: [`src/test_withdraw_circuit_breaker.rs`](../src/test_withdraw_circuit_breaker.rs)

---

### `request_withdrawal`

```rust
pub fn request_withdrawal(env: Env, to: Address, amount: i128, token: Address, memo_hash: Option<BytesN<32>>, risk_tier: u32,) -> Result<u64, Error>
```

**Purpose**: Enqueues a timelocked withdrawal request and records liability in the vault accumulator.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `to` | `Address` | Input parameter `to` of type `Address`. |
| `amount` | `i128` | Input parameter `amount` of type `i128`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `memo_hash` | `Option<BytesN<32>>` | Input parameter `memo_hash` of type `Option<BytesN<32>>`. |
| `risk_tier` | `u32` | Input parameter `risk_tier` of type `u32`. |

**Return Value**: `Result<u64, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::CooldownActive`, `Error::InsufficientFunds`, `Error::InternalError`, `Error::Overflow`, `Error::TokenNotWhitelisted`, `Error::ZeroAmount`

**Events Emitted**:
`WithdrawalRequestedEvent`

**Storage Effects**: Instance storage updated, Persistent storage entry written

**Associated Test File**: [`src/test_request_withdrawal.rs`](../src/test_request_withdrawal.rs)

---

### `execute_withdrawal`

```rust
pub fn execute_withdrawal(env: Env, request_id: u64, partial_amount: Option<i128>, expected_price: i128, max_slippage: u32, nonce: u64,) -> Result<(), Error>
```

**Purpose**: Executes an unlocked withdrawal request, transferring tokens to the recipient and updating liability accumulators.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `request_id` | `u64` | Input parameter `request_id` of type `u64`. |
| `partial_amount` | `Option<i128>` | Input parameter `partial_amount` of type `Option<i128>`. |
| `expected_price` | `i128` | Input parameter `expected_price` of type `i128`. |
| `max_slippage` | `u32` | Input parameter `max_slippage` of type `u32`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::AntiSandwichDelayActive`, `Error::InsufficientFunds`, `Error::InternalError`, `Error::OracleNotSet`, `Error::OraclePriceInvalid`, `Error::RequestNotFound`, `Error::TokenNotWhitelisted`, `Error::WithdrawalLocked`, `Error::ZeroAmount`

**Events Emitted**:
`WithdrawalExecutedEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test_execute_withdrawal_denylist.rs`](../src/test_execute_withdrawal_denylist.rs)

---

### `cancel_withdrawal`

```rust
pub fn cancel_withdrawal(env: Env, request_id: u64) -> Result<(), Error>
```

**Purpose**: Cancels a pending withdrawal request and releases reserved liabilities back to the vault.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `request_id` | `u64` | Input parameter `request_id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InternalError`, `Error::RequestNotFound`

**Events Emitted**:
`WithdrawalCancelledEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test_cancel_withdrawal_invariants.rs`](../src/test_cancel_withdrawal_invariants.rs)

---

### `reclaim_expired_withdrawal`

```rust
pub fn reclaim_expired_withdrawal(env: Env, request_id: u64) -> Result<(), Error>
```

**Purpose**: Reclaim an expired withdrawal request.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `request_id` | `u64` | Input parameter `request_id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InternalError`, `Error::RequestNotFound`, `Error::WithdrawalLocked`

**Events Emitted**:
`WithdrawalExpiredEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test_reclaim_expired_withdrawal_invariants.rs`](../src/test_reclaim_expired_withdrawal_invariants.rs)

---

### `set_withdrawal_cooldown`

```rust
pub fn set_withdrawal_cooldown(env: Env, ledgers: u32, threshold: i128) -> Result<(), Error>
```

**Purpose**: Configure the withdrawal cooldown applied after a large deposit.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |
| `threshold` | `i128` | Input parameter `threshold` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_withdrawal_cooldown`

```rust
pub fn get_withdrawal_cooldown(env: Env) -> u32
```

**Purpose**: Executes `get_withdrawal_cooldown` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_withdrawal_threshold`

```rust
pub fn get_withdrawal_threshold(env: Env) -> i128
```

**Purpose**: Executes `get_withdrawal_threshold` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_withdrawal_request`

```rust
pub fn get_withdrawal_request(env: Env, id: u64) -> Option<WithdrawRequest>
```

**Purpose**: Executes `get_withdrawal_request` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Option<WithdrawRequest>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_get_withdrawal_request_invariants.rs`](../src/test_get_withdrawal_request_invariants.rs)

---

### `get_wq_depth`

```rust
pub fn get_wq_depth(env: Env) -> u64
```

**Purpose**: Executes `get_wq_depth` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_wq_oldest_queued_ledger`

```rust
pub fn get_wq_oldest_queued_ledger(env: Env) -> Option<u32>
```

**Purpose**: Executes `get_wq_oldest_queued_ledger` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<u32>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_wq_oldest_age_ledgers`

```rust
pub fn get_wq_oldest_age_ledgers(env: Env) -> Option<u32>
```

**Purpose**: Executes `get_wq_oldest_age_ledgers` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<u32>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_total_withdrawn`

```rust
pub fn get_total_withdrawn(env: Env) -> Result<i128, Error>
```

**Purpose**: Executes `get_total_withdrawn` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<i128, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::InternalError`, `Error::NotInitialized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_withdrawal_quota`

```rust
pub fn set_withdrawal_quota(env: Env, quota: i128) -> Result<(), Error>
```

**Purpose**: ── Withdrawal Quota ──────────────────────────────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `quota` | `i128` | Input parameter `quota` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`QuotaSetEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_withdrawal_quota`

```rust
pub fn get_withdrawal_quota(env: Env) -> i128
```

**Purpose**: Executes `get_withdrawal_quota` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_withdrawal_expiry`

```rust
pub fn set_withdrawal_expiry(env: Env, ledgers: u32) -> Result<(), Error>
```

**Purpose**: Set the number of ledgers after which an unexecuted withdrawal request can be reclaimed by the admin. Pass `0` to use the compile-time default (`WITHDRAWAL_EXPIRY_WINDOW_LEDGERS`).

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_set_withdrawal_expiry_invariants.rs`](../src/test_set_withdrawal_expiry_invariants.rs)

---

### `get_withdrawal_expiry`

```rust
pub fn get_withdrawal_expiry(env: Env) -> u32
```

**Purpose**: Executes `get_withdrawal_expiry` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_user_daily_withdrawal`

```rust
pub fn get_user_daily_withdrawal(env: Env, user: Address) -> i128
```

**Purpose**: Executes `get_user_daily_withdrawal` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_next_priority_withdrawal`

```rust
pub fn get_next_priority_withdrawal(env: Env) -> Option<u64>
```

**Purpose**: ── Issue #226: withdrawal queue risk-tier prioritization ───────────── Return the `request_id` that should be processed next according to risk-tier priority.  Tier 0 is the highest priority; within each tier FIFO order is preserved.  Returns `None` when the queue is empty.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<u64>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_get_next_priority_withdrawal_invariants.rs`](../src/test_get_next_priority_withdrawal_invariants.rs)

---

### `get_withdrawal_execution_nonce`

```rust
pub fn get_withdrawal_execution_nonce(env: Env, user: Address) -> u64
```

**Purpose**: Get the current withdrawal execution nonce for a user

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

## 3. Administration

### `init`

```rust
pub fn init(env: Env, admin: Address, token: Address, limit: i128, min_deposit: i128, signers: Vec<Address>, threshold: u32, nonce: u64,) -> Result<(), Error>
```

**Purpose**: Initializes the `FiatBridge` contract configuration, token limits, and multisig governance.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Input parameter `admin` of type `Address`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `limit` | `i128` | Input parameter `limit` of type `i128`. |
| `min_deposit` | `i128` | Input parameter `min_deposit` of type `i128`. |
| `signers` | `Vec<Address>` | Input parameter `signers` of type `Vec<Address>`. |
| `threshold` | `u32` | Input parameter `threshold` of type `u32`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: `admin.require_auth()`

**Relevant Error Conditions**:
`Error::AlreadyInitialized`, `Error::BelowMinimum`, `Error::DuplicateSigner`, `Error::InvalidAmount`, `Error::InvalidThreshold`, `Error::MaxSignersReached`, `Error::SelfReferentialAddress`, `Error::Unauthorized`, `Error::ZeroAmount`

**Events Emitted**:
`DeployHashEvent`

**Storage Effects**: Instance storage updated, Persistent storage entry written

**Associated Test File**: [`src/test_init_validation.rs`](../src/test_init_validation.rs)

---

### `get_init_nonce`

```rust
pub fn get_init_nonce(env: Env, admin: Address) -> u64
```

**Purpose**: Executes `get_init_nonce` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Input parameter `admin` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_init_validation.rs`](../src/test_init_validation.rs)

---

### `get_set_limit_nonce`

```rust
pub fn get_set_limit_nonce(env: Env, admin: Address) -> u64
```

**Purpose**: Executes `get_set_limit_nonce` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Input parameter `admin` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_limit`

```rust
pub fn set_limit(env: Env, token: Address, limit: i128, nonce: u64) -> Result<(), Error>
```

**Purpose**: Sets the per-transaction limit for a specific token with replay protection.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `limit` | `i128` | Input parameter `limit` of type `i128`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ExceedsLimitMaxCap`, `Error::TokenNotWhitelisted`, `Error::ZeroAmount`

**Events Emitted**:
`SetLimitEvent`

**Storage Effects**: Persistent storage entry written

**Associated Test File**: [`src/test_set_limit.rs`](../src/test_set_limit.rs)

---

### `register_token`

```rust
pub fn register_token(env: Env, token: Address, limit: i128, daily_limit: i128,) -> Result<(), Error>
```

**Purpose**: Registers an additional token so it can be deposited, queued for withdrawal and swept for fees alongside the primary token (Issue #1400).

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `limit` | `i128` | Input parameter `limit` of type `i128`. |
| `daily_limit` | `i128` | Input parameter `daily_limit` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ExceedsLimit`, `Error::ExceedsLimitMaxCap`, `Error::InvalidAmount`, `Error::SelfReferentialAddress`, `Error::TokenAlreadyRegistered`, `Error::ZeroAmount`

**Events Emitted**:
`TokenRegisteredEvent`

**Storage Effects**: Persistent storage entry written

**Associated Test File**: [`src/test_issues_1400_1403.rs`](../src/test_issues_1400_1403.rs)

---

### `get_token_config`

```rust
pub fn get_token_config(env: Env, token: Address) -> Option<TokenConfig>
```

**Purpose**: Returns the registry entry (limits and accounting totals) for `token`, or `None` if the token is not registered.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |

**Return Value**: `Option<TokenConfig>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_issues_1400_1403.rs`](../src/test_issues_1400_1403.rs)

---

### `set_token_allowlist_enabled`

```rust
pub fn set_token_allowlist_enabled(env: Env, token: Address, enabled: bool,) -> Result<(), Error>
```

**Purpose**: Executes `set_token_allowlist_enabled` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `enabled` | `bool` | Input parameter `enabled` of type `bool`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::Overflow`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Instance storage updated, Persistent storage entry written

**Associated Test File**: [`src/test_issues_1400_1403.rs`](../src/test_issues_1400_1403.rs)

---

### `add_token_allowlist`

```rust
pub fn add_token_allowlist(env: Env, token: Address, address: Address) -> Result<(), Error>
```

**Purpose**: Executes `add_token_allowlist` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `address` | `Address` | Input parameter `address` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::Overflow`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Instance storage updated, Persistent storage entry written

**Associated Test File**: [`src/test_issues_1400_1403.rs`](../src/test_issues_1400_1403.rs)

---

### `remove_token_allowlist`

```rust
pub fn remove_token_allowlist(env: Env, token: Address, address: Address) -> Result<(), Error>
```

**Purpose**: Executes `remove_token_allowlist` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `address` | `Address` | Input parameter `address` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Persistent storage entry removed

**Associated Test File**: [`src/test_token_allowlist_invariants.rs`](../src/test_token_allowlist_invariants.rs)

---

### `set_cooldown`

```rust
pub fn set_cooldown(env: Env, ledgers: u32) -> Result<(), Error>
```

**Purpose**: Executes `set_cooldown` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_lock_period`

```rust
pub fn set_lock_period(env: Env, ledgers: u32) -> Result<(), Error>
```

**Purpose**: Set the withdrawal lock period in ledgers.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
`SetLockPeriodEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `pause`

```rust
pub fn pause(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `pause` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`PausedEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test_pause_invariants.rs`](../src/test_pause_invariants.rs)

---

### `unpause`

```rust
pub fn unpause(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `unpause` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`UnpausedEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `batch_unpause`

```rust
pub fn batch_unpause(env: Env, count: u32) -> Result<u32, Error>
```

**Purpose**: Batch variant of [`unpause`](FiatBridge::unpause): unpauses the contract `count` times in a single invocation. Each unpause emits its own `UnpausedEvent` so off-chain indexers see the full sequence. Returns the number of unpauses actually applied (always equal to `count` on success).

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `count` | `u32` | Input parameter `count` of type `u32`. |

**Return Value**: `Result<u32, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`UnpausedEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_anti_sandwich_delay`

```rust
pub fn set_anti_sandwich_delay(env: Env, ledgers: u32) -> Result<(), Error>
```

**Purpose**: Set the anti-sandwich delay in ledgers. Use 0 to disable. Requires admin.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_edge_case_validations.rs`](../src/test_edge_case_validations.rs)

---

### `transfer_admin`

```rust
pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error>
```

**Purpose**: Executes `transfer_admin` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `new_admin` | `Address` | Input parameter `new_admin` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::SameAdmin`

**Events Emitted**:
`AdminTransferEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `accept_admin`

```rust
pub fn accept_admin(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `accept_admin` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: `pending.require_auth()`

**Relevant Error Conditions**:
`Error::ActionNotReady`, `Error::NoPendingAdmin`, `Error::NotInitialized`, `Error::Overflow`

**Events Emitted**:
`AdminTransferEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_oracle`

```rust
pub fn set_oracle(env: Env, oracle: Address) -> Result<(), Error>
```

**Purpose**: ── Fiat Limits & Oracle ────────────────────────────────────────────── Set the oracle contract address for fiat price validation. Requires admin. Returns Error::SelfReferentialAddress if oracle == admin or contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `oracle` | `Address` | Input parameter `oracle` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::SelfReferentialAddress`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_fiat_limit`

```rust
pub fn set_fiat_limit(env: Env, limit_usd_cents: i128) -> Result<(), Error>
```

**Purpose**: Executes `set_fiat_limit` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `limit_usd_cents` | `i128` | Input parameter `limit_usd_cents` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_edge_case_validations.rs`](../src/test_edge_case_validations.rs)

---

### `queue_admin_action`

```rust
pub fn queue_admin_action(env: Env, action_type: Symbol, payload: Bytes, delay: u32,) -> Result<u64, Error>
```

**Purpose**: ── Timelock ────────────────────────────────────────────────────────── Queues an administrative action subject to a mandatory timelock delay.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `action_type` | `Symbol` | Input parameter `action_type` of type `Symbol`. |
| `payload` | `Bytes` | Input parameter `payload` of type `Bytes`. |
| `delay` | `u32` | Input parameter `delay` of type `u32`. |

**Return Value**: `Result<u64, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ActionNotReady`, `Error::Overflow`

**Events Emitted**:
`AdminActionQueuedEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `execute_admin_action`

```rust
pub fn execute_admin_action(env: Env, id: u64) -> Result<(), Error>
```

**Purpose**: Executes `execute_admin_action` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ActionNotQueued`, `Error::ActionNotReady`

**Events Emitted**:
`AdminActionExecutedEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_issue_1389.rs`](../src/test_issue_1389.rs)

---

### `cancel_admin_action`

```rust
pub fn cancel_admin_action(env: Env, id: u64) -> Result<(), Error>
```

**Purpose**: Executes `cancel_admin_action` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ActionNotQueued`

**Events Emitted**:
`AdminActionExecutedEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_issue_1389.rs`](../src/test_issue_1389.rs)

---

### `get_queued_admin_action`

```rust
pub fn get_queued_admin_action(env: Env, id: u64) -> Option<QueuedAdminAction>
```

**Purpose**: Executes `get_queued_admin_action` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Option<QueuedAdminAction>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_inactivity_threshold`

```rust
pub fn set_inactivity_threshold(env: Env, threshold: u32) -> Result<(), Error>
```

**Purpose**: Set the inactivity threshold for operator pruning and emergency recovery.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `threshold` | `u32` | Input parameter `threshold` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
`InactivityThresholdSetEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_emergency_recovery.rs`](../src/test_emergency_recovery.rs)

---

### `get_inactivity_threshold`

```rust
pub fn get_inactivity_threshold(env: Env) -> u32
```

**Purpose**: Return the currently configured inactivity threshold, or DEFAULT_INACTIVITY_THRESHOLD.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_emergency_recovery.rs`](../src/test_emergency_recovery.rs)

---

### `get_last_admin_action_ledger`

```rust
pub fn get_last_admin_action_ledger(env: Env) -> u32
```

**Purpose**: Return the ledger sequence of the most recent admin-authenticated action.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_emergency_recovery.rs`](../src/test_emergency_recovery.rs)

---

### `deny_address`

```rust
pub fn deny_address(env: Env, address: Address) -> Result<(), Error>
```

**Purpose**: ── Denylist ────────────────────────────────────────────────────────── Adds an address to the persistent denylist and increments the enumeration counter.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `address` | `Address` | Input parameter `address` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::MaxDeniedReached`, `Error::Overflow`

**Events Emitted**:
`DenyAddressEvent`

**Storage Effects**: Instance storage updated, Persistent storage entry written

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `queue_renounce_admin`

```rust
pub fn queue_renounce_admin(env: Env) -> Result<(), Error>
```

**Purpose**: ── Ownership Renounce ────────────────────────────────────────────────

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::Overflow`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `remove_denied_address`

```rust
pub fn remove_denied_address(env: Env, address: Address) -> Result<(), Error>
```

**Purpose**: Removes an address from the denylist and tombstones its index slot. Removing an address that is not denied is a no-op and emits no event.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `address` | `Address` | Input parameter `address` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`DenyRemovedEvent`

**Storage Effects**: Persistent storage entry removed

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `is_denied`

```rust
pub fn is_denied(env: Env, address: Address) -> Result<bool, Error>
```

**Purpose**: Checks if an address is on the denylist.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `address` | `Address` | Input parameter `address` of type `Address`. |

**Return Value**: `Result<bool, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::Overflow`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_is_denied_invariants.rs`](../src/test_is_denied_invariants.rs)

---

### `get_denied_addresses`

```rust
pub fn get_denied_addresses(env: Env, offset: u64, limit: u32) -> Vec<Address>
```

**Purpose**: Executes `get_denied_addresses` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `offset` | `u64` | Input parameter `offset` of type `u64`. |
| `limit` | `u32` | Input parameter `limit` of type `u32`. |

**Return Value**: `Vec<Address>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_token_allowlist`

```rust
pub fn get_token_allowlist(env: Env, offset: u64, limit: u32) -> Vec<TokenAllowlistEntry>
```

**Purpose**: Executes `get_token_allowlist` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `offset` | `u64` | Input parameter `offset` of type `u64`. |
| `limit` | `u32` | Input parameter `limit` of type `u32`. |

**Return Value**: `Vec<TokenAllowlistEntry>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_token_allowlist_invariants.rs`](../src/test_token_allowlist_invariants.rs)

---

### `get_token_allowlist_enabled`

```rust
pub fn get_token_allowlist_enabled(env: Env, offset: u64, limit: u32,) -> Vec<TokenAllowlistEnabledEntry>
```

**Purpose**: Executes `get_token_allowlist_enabled` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `offset` | `u64` | Input parameter `offset` of type `u64`. |
| `limit` | `u32` | Input parameter `limit` of type `u32`. |

**Return Value**: `Vec<TokenAllowlistEnabledEntry>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_token_allowlist_invariants.rs`](../src/test_token_allowlist_invariants.rs)

---

### `accrue_fee`

```rust
pub fn accrue_fee(env: Env, token: Address, amount: i128) -> Result<(), Error>
```

**Purpose**: ── Fee Vault ───────────────────────────────────────────────────────── Records that protocol fees have been received for a token.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `amount` | `i128` | Input parameter `amount` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ZeroAmount`

**Events Emitted**:
`FeeAccruedEvent`

**Storage Effects**: Persistent storage entry written

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `cancel_renounce_admin`

```rust
pub fn cancel_renounce_admin(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `cancel_renounce_admin` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ActionNotQueued`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_accrued_fees`

```rust
pub fn get_accrued_fees(env: Env, token: Address) -> i128
```

**Purpose**: Executes `get_accrued_fees` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_accrued_fees_authenticated`

```rust
pub fn get_accrued_fees_authenticated(env: Env, caller: Address, token: Address,) -> Result<i128, Error>
```

**Purpose**: Admin-only variant of `get_accrued_fees` that enforces a timelock role check before returning the vault balance.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Input parameter `caller` of type `Address`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |

**Return Value**: `Result<i128, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`), Caller (`caller.require_auth()`)

**Relevant Error Conditions**:
`Error::Unauthorized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `withdraw_fees`

```rust
pub fn withdraw_fees(env: Env, to: Address, token: Address, amount: i128, nonce: u64,) -> Result<(), Error>
```

**Purpose**: Withdraws accrued protocol fees for a specific token to the fee recipient.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `to` | `Address` | Input parameter `to` of type `Address`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `amount` | `i128` | Input parameter `amount` of type `i128`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::FeeWithdrawalExceedsBalance`, `Error::NoFeesToWithdraw`, `Error::ZeroAmount`

**Events Emitted**:
`FeeWithdrawnEvent`, `FeeVaultReconciledEvent`

**Storage Effects**: Persistent storage entry written

**Associated Test File**: [`src/test_withdraw_fees_invariants.rs`](../src/test_withdraw_fees_invariants.rs)

---

### `withdraw_fees_batch`

```rust
pub fn withdraw_fees_batch(env: Env, to: Address, tokens: Vec<Address>, nonce: u64,) -> Result<(), Error>
```

**Purpose**: Atomically sweeps accrued protocol fees across multiple registered tokens.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `to` | `Address` | Input parameter `to` of type `Address`. |
| `tokens` | `Vec<Address>` | Input parameter `tokens` of type `Vec<Address>`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`FeeWithdrawnEvent`

**Storage Effects**: Persistent storage entry written

**Associated Test File**: [`src/test_withdraw_fees_batch_invariants.rs`](../src/test_withdraw_fees_batch_invariants.rs)

---

### `execute_renounce_admin`

```rust
pub fn execute_renounce_admin(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `execute_renounce_admin` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ActionNotQueued`, `Error::ActionNotReady`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `rescue_token`

```rust
pub fn rescue_token(env: Env, token: Address, to: Address, amount: i128) -> Result<(), Error>
```

**Purpose**: ── Emergency Token Rescue ────────────────────────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `to` | `Address` | Input parameter `to` of type `Address`. |
| `amount` | `i128` | Input parameter `amount` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ExceedsLimit`, `Error::InsufficientFunds`, `Error::InvalidRecipient`, `Error::NotInitialized`, `Error::RescueForbidden`, `Error::ZeroAmount`

**Events Emitted**:
`RescueEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_admin`

```rust
pub fn get_admin(env: Env) -> Result<Address, Error>
```

**Purpose**: ── View Functions ────────────────────────────────────────────────────

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<Address, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_token`

```rust
pub fn get_token(env: Env) -> Result<Address, Error>
```

**Purpose**: Executes `get_token` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<Address, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::NotInitialized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_limit`

```rust
pub fn get_limit(env: Env) -> Result<i128, Error>
```

**Purpose**: Executes `get_limit` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<i128, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::InternalError`, `Error::NotInitialized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_user_available_balance`

```rust
pub fn get_user_available_balance(env: Env, user: Address, token: Address) -> i128
```

**Purpose**: Returns the available balance for a user for a specific token. This is the amount that can be requested for withdrawal, accounting for all pending withdrawal requests.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Input parameter `user` of type `Address`. |
| `token` | `Address` | Input parameter `token` of type `Address`. |

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_lock_period`

```rust
pub fn get_lock_period(env: Env) -> u32
```

**Purpose**: Executes `get_lock_period` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_cooldown`

```rust
pub fn get_cooldown(env: Env) -> u32
```

**Purpose**: Executes `get_cooldown` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_slippage_threshold`

```rust
pub fn get_slippage_threshold(env: Env) -> u32
```

**Purpose**: Executes `get_slippage_threshold` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_edge_case_validations.rs`](../src/test_edge_case_validations.rs)

---

### `set_slippage_threshold`

```rust
pub fn set_slippage_threshold(env: Env, threshold_bps: u32) -> Result<(), Error>
```

**Purpose**: Set the protocol-wide maximum slippage, in basis points (BPS).

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `threshold_bps` | `u32` | Input parameter `threshold_bps` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`, `Error::SlippageTooHigh`

**Events Emitted**:
`SlippageThresholdSetEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_edge_case_validations.rs`](../src/test_edge_case_validations.rs)

---

### `set_fee_recipient`

```rust
pub fn set_fee_recipient(env: Env, recipient: Address) -> Result<(), Error>
```

**Purpose**: ── Issue #1044: fee recipient management ───────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `recipient` | `Address` | Input parameter `recipient` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidRecipient`

**Events Emitted**:
`FeeRecipientSetEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_set_fee_recipient_invariants.rs`](../src/test_set_fee_recipient_invariants.rs)

---

### `clear_fee_recipient`

```rust
pub fn clear_fee_recipient(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `clear_fee_recipient` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`FeeRecipientSetEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_set_fee_recipient_invariants.rs`](../src/test_set_fee_recipient_invariants.rs)

---

### `get_fee_recipient`

```rust
pub fn get_fee_recipient(env: Env) -> Option<Address>
```

**Purpose**: Executes `get_fee_recipient` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<Address>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_set_fee_recipient_invariants.rs`](../src/test_set_fee_recipient_invariants.rs)

---

### `get_pending_renounce_ledger`

```rust
pub fn get_pending_renounce_ledger(env: Env) -> Option<u32>
```

**Purpose**: Executes `get_pending_renounce_ledger` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<u32>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_anti_sandwich_delay`

```rust
pub fn get_anti_sandwich_delay(env: Env) -> u32
```

**Purpose**: Executes `get_anti_sandwich_delay` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_edge_case_validations.rs`](../src/test_edge_case_validations.rs)

---

### `get_total_liabilities`

```rust
pub fn get_total_liabilities(env: Env) -> Result<i128, Error>
```

**Purpose**: Executes `get_total_liabilities` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<i128, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::InternalError`, `Error::NotInitialized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_config_snapshot`

```rust
pub fn get_config_snapshot(env: Env) -> Result<ConfigSnapshot, Error>
```

**Purpose**: Executes `get_config_snapshot` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<ConfigSnapshot, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::NotInitialized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `execute_batch_admin`

```rust
pub fn execute_batch_admin(env: Env, operations: Vec<BatchAdminOp>,) -> Result<BatchResult, Error>
```

**Purpose**: ── Batched Admin Operations ──────────────────────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operations` | `Vec<BatchAdminOp>` | Input parameter `operations` of type `Vec<BatchAdminOp>`. |

**Return Value**: `Result<BatchResult, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotAllowed`

**Events Emitted**:
`AdminRoleCheckEvent`, `BatchFailEvent`, `BatchOkEvent`, `op`, `success_count`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_event_version`

```rust
pub fn get_event_version(_env: Env) -> u32
```

**Purpose**: Executes `get_event_version` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_deploy_config_hash`

```rust
pub fn get_deploy_config_hash(env: Env) -> Option<BytesN<32>>
```

**Purpose**: ── Issue #214: deployment config hash view ─────────────────────────── Return the SHA-256 hash of the critical deployment parameters that was computed and stored immutably during `init`.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<BytesN<32>>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_get_deploy_config_hash_invariants.rs`](../src/test_get_deploy_config_hash_invariants.rs)

---

### `get_contract_version`

```rust
pub fn get_contract_version(env: Env) -> u32
```

**Purpose**: Returns the currently stored contract version.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `build_set_limit_op`

```rust
pub fn build_set_limit_op(env: &Env, token: Address, limit: i128,) -> BatchAdminOp
```

**Purpose**: Executes `build_set_limit_op` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | Input parameter `token` of type `Address`. |
| `limit` | `i128` | Input parameter `limit` of type `i128`. |

**Return Value**: `BatchAdminOp`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_limit_max_cap`

```rust
pub fn set_limit_max_cap(env: Env, cap: i128) -> Result<(), Error>
```

**Purpose**: ── Missing methods referenced by tests ────────────────────────────── Set a hard cap on the maximum value that can be passed to `set_limit`.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `cap` | `i128` | Input parameter `cap` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::LimitCapCannotBeLowered`, `Error::ZeroAmount`

**Events Emitted**:
`LimitMaxCapSetEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_set_limit_max_cap`

```rust
pub fn get_set_limit_max_cap(env: Env) -> i128
```

**Purpose**: Return the configured limit max cap (defaults to `i128::MAX`).

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_pending_admin`

```rust
pub fn get_pending_admin(env: Env) -> Option<(Address, u64)>
```

**Purpose**: Return the pending admin transfer info `(new_admin, proposed_at_ledger)`, if any.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<(Address, u64)>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_fee_withdrawal_nonce`

```rust
pub fn get_fee_withdrawal_nonce(env: Env, caller: Address) -> u64
```

**Purpose**: Return the current nonce for fee withdrawals (used for replay protection).

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Input parameter `caller` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_get_fee_withdrawal_nonce_invariants.rs`](../src/test_get_fee_withdrawal_nonce_invariants.rs)

---

### `get_fee_withdrawal_batch_nonce`

```rust
pub fn get_fee_withdrawal_batch_nonce(env: Env, caller: Address) -> u64
```

**Purpose**: Deprecated alias for [`FiatBridge::get_fee_withdrawal_nonce`].

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Input parameter `caller` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_fee_withdrawal_nonce.rs`](../src/test_fee_withdrawal_nonce.rs)

---

## 4. Operators

### `set_operator`

```rust
pub fn set_operator(env: Env, operator: Address, active: bool, nonce: u64,) -> Result<(), Error>
```

**Purpose**: ── Operator Role & Heartbeat ─────────────────────────────────────── Set the active status of an operator address.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |
| `active` | `bool` | Input parameter `active` of type `bool`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidRecipient`, `Error::NotAllowed`, `Error::NotOperator`, `Error::OperatorCapReached`

**Events Emitted**:
`SetOperatorEvent`, `NonceConsumedEvent`, `bool`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_set_operator_invariants.rs`](../src/test_set_operator_invariants.rs)

---

### `set_max_operators`

```rust
pub fn set_max_operators(env: Env, max_operators: u32) -> Result<(), Error>
```

**Purpose**: Executes `set_max_operators` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `max_operators` | `u32` | Input parameter `max_operators` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ExceedsLimit`

**Events Emitted**:
`SetMaxOperatorsEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_set_max_operators_event.rs`](../src/test_set_max_operators_event.rs)

---

### `get_set_operator_nonce`

```rust
pub fn get_set_operator_nonce(env: Env, admin: Address) -> u64
```

**Purpose**: Get the current set_operator nonce for an admin.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Input parameter `admin` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_issue_1387.rs`](../src/test_issue_1387.rs)

---

### `heartbeat`

```rust
pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error>
```

**Purpose**: Executes `heartbeat` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_heartbeat_batch.rs`](../src/test_heartbeat_batch.rs)

---

### `heartbeat_batch`

```rust
pub fn heartbeat_batch(env: Env, items: Vec<HeartbeatItem>,) -> Result<BatchHeartbeatResult, Error>
```

**Purpose**: Executes a batch of operator heartbeats in a single call.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `items` | `Vec<HeartbeatItem>` | Input parameter `items` of type `Vec<HeartbeatItem>`. |

**Return Value**: `Result<BatchHeartbeatResult, Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`HeartbeatBatchEvent`, `HeartbeatBatchFailEvent`, `total_items`, `success_count`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_heartbeat_batch.rs`](../src/test_heartbeat_batch.rs)

---

### `is_operator`

```rust
pub fn is_operator(env: Env, operator: Address) -> bool
```

**Purpose**: Executes `is_operator` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |

**Return Value**: `bool`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_is_operator_event.rs`](../src/test_is_operator_event.rs)

---

### `get_operator_heartbeat`

```rust
pub fn get_operator_heartbeat(env: Env, operator: Address) -> Option<u32>
```

**Purpose**: Executes `get_operator_heartbeat` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |

**Return Value**: `Option<u32>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_operator_nonce`

```rust
pub fn get_operator_nonce(env: Env, operator: Address) -> u64
```

**Purpose**: Executes `get_operator_nonce` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `prune_inactive_operators`

```rust
pub fn prune_inactive_operators(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `prune_inactive_operators` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_prune_inactive_operators_event.rs`](../src/test_prune_inactive_operators_event.rs)

---

### `set_withdraw_operator`

```rust
pub fn set_withdraw_operator(env: Env, operator: Address) -> Result<(), Error>
```

**Purpose**: ── Single Withdraw Operator Role (Issue #118) ─────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidRecipient`, `Error::NotAllowed`

**Events Emitted**:
`SetWithdrawOperatorEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `remove_withdraw_operator`

```rust
pub fn remove_withdraw_operator(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `remove_withdraw_operator` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`RemoveWithdrawOperatorEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_withdraw_operator`

```rust
pub fn get_withdraw_operator(env: Env) -> Option<Address>
```

**Purpose**: Executes `get_withdraw_operator` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<Address>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_operator_daily_limit`

```rust
pub fn set_operator_daily_limit(env: Env, operator: Address, limit: i128) -> Result<(), Error>
```

**Purpose**: Set a per-operator rolling 24h withdrawal limit.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `operator` | `Address` | Input parameter `operator` of type `Address`. |
| `limit` | `i128` | Input parameter `limit` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
`OperatorDailyLimitSetEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

## 5. Upgrades

### `get_escrow_storage_version`

```rust
pub fn get_escrow_storage_version(env: Env) -> u32
```

**Purpose**: ── Escrow Migration ────────────────────────────────────────────────── Returns the current escrow storage schema version — the canonical way to check migration status.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `migrate_escrow`

```rust
pub fn migrate_escrow(env: Env, batch_size: u32) -> Result<u32, Error>
```

**Purpose**: Migrate receipt data to persistent escrow records in batches. Returns count migrated in this batch. Requires admin. Emits MigrationEvent.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `batch_size` | `u32` | Input parameter `batch_size` of type `u32`. |

**Return Value**: `Result<u32, Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::MigrationAlreadyComplete`

**Events Emitted**:
`MigrationEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_migrate_escrow_invariants.rs`](../src/test_migrate_escrow_invariants.rs)

---

### `get_escrow_record`

```rust
pub fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord>
```

**Purpose**: Look up a migrated escrow position by its sequential deposit id. Returns None if not yet migrated or missing. Plain storage read (no auth required).

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Option<EscrowRecord>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_migration_cursor`

```rust
pub fn get_migration_cursor(env: Env) -> u64
```

**Purpose**: Returns the current migration cursor position (how many receipts have been migrated). Plain storage read (no auth required). Defaults to 0 if not yet set.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `set_migration_cursor`

```rust
pub fn set_migration_cursor(env: Env, cursor: u64) -> Result<(), Error>
```

**Purpose**: Set the migration cursor to a specific value.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `cursor` | `u64` | Input parameter `cursor` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::InvalidAmount`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_edge_case_validations.rs`](../src/test_edge_case_validations.rs)

---

### `set_upgrade_delay`

```rust
pub fn set_upgrade_delay(env: Env, ledgers: u32) -> Result<(), Error>
```

**Purpose**: ── Issue #107: Governed upgrade mechanism ────────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::UpgradeDelayTooShort`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_upgrade_delay`

```rust
pub fn get_upgrade_delay(env: Env) -> u32
```

**Purpose**: Executes `get_upgrade_delay` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `propose_upgrade`

```rust
pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32,) -> Result<(), Error>
```

**Purpose**: Proposes a contract WASM upgrade subject to a timelock delay.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `new_wasm_hash` | `BytesN<32>` | Input parameter `new_wasm_hash` of type `BytesN<32>`. |
| `new_version` | `u32` | Input parameter `new_version` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::DowngradeNotAllowed`

**Events Emitted**:
`UpgradeProposedEvent`

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test_propose_upgrade_invariants.rs`](../src/test_propose_upgrade_invariants.rs)

---

### `execute_upgrade`

```rust
pub fn execute_upgrade(env: Env) -> Result<(), Error>
```

**Purpose**: Executes `execute_upgrade` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::InternalError`, `Error::UpgradeNotReady`, `Error::UpgradeProposalMissing`

**Events Emitted**:
`UpgradeExecutedEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `cancel_upgrade`

```rust
pub fn cancel_upgrade(env: Env, nonce: u64) -> Result<(), Error>
```

**Purpose**: Executes `cancel_upgrade` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `nonce` | `u64` | Input parameter `nonce` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::UpgradeProposalMissing`

**Events Emitted**:
`UpgradeCancelledEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_upgrade_proposal`

```rust
pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal>
```

**Purpose**: Executes `get_upgrade_proposal` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<UpgradeProposal>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_upgrade_proposal_timing`

```rust
pub fn get_upgrade_proposal_timing(env: Env) -> Option<UpgradeProposalTiming>
```

**Purpose**: Return the ledger and delay recorded for the pending upgrade.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<UpgradeProposalTiming>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_execute_upgrade_invariants.rs`](../src/test_execute_upgrade_invariants.rs)

---

### `migrate_upgrade_proposal_timing`

```rust
pub fn migrate_upgrade_proposal_timing(env: Env) -> Result<(), Error>
```

**Purpose**: Add timing metadata to a proposal made by earlier contract versions. Its original execution deadline remains unchanged.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Instance storage updated

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_upgrade_cancellation_nonce`

```rust
pub fn get_upgrade_cancellation_nonce(env: Env, admin: Address) -> u64
```

**Purpose**: Get the current upgrade cancellation nonce for an admin

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Input parameter `admin` of type `Address`. |

**Return Value**: `u64`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

## 6. Multisig

### `propose_multisig_action`

```rust
pub fn propose_multisig_action(env: Env, proposer: Address, action: BatchAdminOp,) -> Result<u64, Error>
```

**Purpose**: ── Issue #100: Multi-sig Logic ──────────────────────────────────────────

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `proposer` | `Address` | Input parameter `proposer` of type `Address`. |
| `action` | `BatchAdminOp` | Input parameter `action` of type `BatchAdminOp`. |

**Return Value**: `Result<u64, Error>`

**Authentication & Authorization**: Multisig Proposer (`proposer.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::Overflow`, `Error::Unauthorized`

**Events Emitted**:
`MultisigProposedEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_propose_multisig_action_invariants.rs`](../src/test_propose_multisig_action_invariants.rs)

---

### `approve_multisig_action`

```rust
pub fn approve_multisig_action(env: Env, signer: Address, id: u64) -> Result<(), Error>
```

**Purpose**: Executes `approve_multisig_action` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `signer` | `Address` | Input parameter `signer` of type `Address`. |
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Multisig Signer (`signer.require_auth()`)

**Relevant Error Conditions**:
`Error::AlreadyApproved`, `Error::NotInitialized`, `Error::ProposalAlreadyExecuted`, `Error::ProposalExpired`, `Error::ProposalNotFound`, `Error::Unauthorized`

**Events Emitted**:
`MultisigApprovedEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_approve_multisig_action_invariants.rs`](../src/test_approve_multisig_action_invariants.rs)

---

### `revoke_multisig_approval`

```rust
pub fn revoke_multisig_approval(env: Env, signer: Address, id: u64) -> Result<(), Error>
```

**Purpose**: Executes `revoke_multisig_approval` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `signer` | `Address` | Input parameter `signer` of type `Address`. |
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Multisig Signer (`signer.require_auth()`)

**Relevant Error Conditions**:
`Error::ProposalAlreadyExecuted`, `Error::ProposalExpired`, `Error::ProposalNotFound`, `Error::SignerNotFound`

**Events Emitted**:
`MultisigRevokedEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_revoke_multisig_approval_invariants.rs`](../src/test_revoke_multisig_approval_invariants.rs)

---

### `execute_multisig_action`

```rust
pub fn execute_multisig_action(env: Env, id: u64) -> Result<(), Error>
```

**Purpose**: Executes `execute_multisig_action` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ProposalAlreadyExecuted`, `Error::ProposalExpired`, `Error::ProposalNotFound`, `Error::ThresholdNotMet`

**Events Emitted**:
`MultisigExecutedEvent`

**Storage Effects**: Persistent storage entry removed

**Associated Test File**: [`src/test_execute_multisig_action_invariants.rs`](../src/test_execute_multisig_action_invariants.rs)

---

### `get_multisig_proposal`

```rust
pub fn get_multisig_proposal(env: Env, id: u64) -> Option<MultisigProposal>
```

**Purpose**: Executes `get_multisig_proposal` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `id` | `u64` | Input parameter `id` of type `u64`. |

**Return Value**: `Option<MultisigProposal>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_get_multisig_proposal_invariants.rs`](../src/test_get_multisig_proposal_invariants.rs)

---

### `get_multisig_signers`

```rust
pub fn get_multisig_signers(env: Env) -> Vec<Address>
```

**Purpose**: Executes `get_multisig_signers` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Vec<Address>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_get_multisig_signers_invariants.rs`](../src/test_get_multisig_signers_invariants.rs)

---

### `get_multisig_threshold`

```rust
pub fn get_multisig_threshold(env: Env) -> u32
```

**Purpose**: Executes `get_multisig_threshold` operations on the `FiatBridge` contract.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_get_multisig_signers_invariants.rs`](../src/test_get_multisig_signers_invariants.rs)

---

### `update_multisig`

```rust
pub fn update_multisig(_env: Env, _signers: Vec<Address>, _threshold: u32,) -> Result<(), Error>
```

**Purpose**: Direct execution of multisig rotation is forbidden. Rotation can only occur through a matured multisig proposal.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `_signers` | `Vec<Address>` | Input parameter `_signers` of type `Vec<Address>`. |
| `_threshold` | `u32` | Input parameter `_threshold` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::Unauthorized`

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `build_update_multisig_op`

```rust
pub fn build_update_multisig_op(env: &Env, signers: Vec<Address>, threshold: u32,) -> BatchAdminOp
```

**Purpose**: Executes `build_update_multisig_op` operations on the `FiatBridge` contract.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `signers` | `Vec<Address>` | Input parameter `signers` of type `Vec<Address>`. |
| `threshold` | `u32` | Input parameter `threshold` of type `u32`. |

**Return Value**: `BatchAdminOp`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

## 7. Emergency Operations

### `set_circuit_breaker_threshold`

```rust
pub fn set_circuit_breaker_threshold(env: Env, threshold: i128) -> Result<(), Error>
```

**Purpose**: ── Issue #209: global circuit breaker ─────────────────────────────── Set the rolling 24-hour withdrawal volume threshold for the circuit breaker. Requires admin. Returns Error::NotInitialized if not initialized.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `threshold` | `i128` | Input parameter `threshold` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_set_circuit_breaker_threshold_invariants.rs`](../src/test_set_circuit_breaker_threshold_invariants.rs)

---

### `set_circuit_breaker_reset_window`

```rust
pub fn set_circuit_breaker_reset_window(env: Env, ledgers: u32) -> Result<(), Error>
```

**Purpose**: Configure the circuit breaker auto-reset window in ledgers. Use u32::MAX to disable auto-reset. Requires admin.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `ledgers` | `u32` | Input parameter `ledgers` of type `u32`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_set_circuit_breaker_reset_window_invariants.rs`](../src/test_set_circuit_breaker_reset_window_invariants.rs)

---

### `get_circuit_breaker_reset_window`

```rust
pub fn get_circuit_breaker_reset_window(env: Env) -> u32
```

**Purpose**: Return the auto-reset window that is currently in effect, in ledgers.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `u32`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `reset_circuit_breaker`

```rust
pub fn reset_circuit_breaker(env: Env) -> Result<(), Error>
```

**Purpose**: Clear a tripped circuit breaker immediately. Emits CircuitBreakerResetEvent. Requires admin. Returns Error::NotInitialized if not initialized.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::NotInitialized`, `Error::ContractPaused`, `Error::Unauthorized` (general contract state and security guards).

**Events Emitted**:
`CircuitBreakerResetEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_reset_circuit_breaker_invariants.rs`](../src/test_reset_circuit_breaker_invariants.rs)

---

### `get_circuit_breaker_threshold`

```rust
pub fn get_circuit_breaker_threshold(env: Env) -> i128
```

**Purpose**: Return the currently configured rolling-volume threshold.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `i128`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `is_circuit_breaker_tripped`

```rust
pub fn is_circuit_breaker_tripped(env: Env) -> bool
```

**Purpose**: Return whether the circuit breaker is currently tripped (pure storage read).

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `bool`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test_is_circuit_breaker_tripped_invariants.rs`](../src/test_is_circuit_breaker_tripped_invariants.rs)

---

### `set_emergency_recovery`

```rust
pub fn set_emergency_recovery(env: Env, recovery: Address, cap: i128) -> Result<(), Error>
```

**Purpose**: Configure the emergency recovery address and an associated withdrawal cap.

**Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `recovery` | `Address` | Input parameter `recovery` of type `Address`. |
| `cap` | `i128` | Input parameter `cap` of type `i128`. |

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: Administrator (`admin.require_auth()`)

**Relevant Error Conditions**:
`Error::ExceedsLimit`, `Error::InvalidRecipient`, `Error::NotInitialized`, `Error::ZeroAmount`

**Events Emitted**:
`EmergencyRecoverySetEvent`

**Storage Effects**: Pure computation / no storage effects

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_emergency_recovery_cap`

```rust
pub fn get_emergency_recovery_cap(env: Env) -> Option<i128>
```

**Purpose**: Return the emergency recovery withdrawal cap, if set.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<i128>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `get_emergency_recovery_address`

```rust
pub fn get_emergency_recovery_address(env: Env) -> Option<Address>
```

**Purpose**: Return the configured emergency recovery address, if set.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Option<Address>`

**Authentication & Authorization**: None (Read-only view function, callable by anyone without signatures)

**Relevant Error Conditions**:
None (Infallible query view).

**Events Emitted**:
None (Read-only view; no state transition event published).

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test.rs`](../src/test.rs)

---

### `trigger_emergency_recovery`

```rust
pub fn trigger_emergency_recovery(env: Env) -> Result<(), Error>
```

**Purpose**: Trigger emergency recovery when the admin has been inactive for longer than InactivityThreshold.

**Parameters**:

This function accepts only the Soroban environment context (`env: Env`).

**Return Value**: `Result<(), Error>`

**Authentication & Authorization**: None (Public invocation, on-chain conditions apply)

**Relevant Error Conditions**:
`Error::InactivityThresholdNotReached`, `Error::InternalError`, `Error::NoEmergencyRecoveryAddress`, `Error::NotInitialized`

**Events Emitted**:
`EmergencyRecoveryEvent`

**Storage Effects**: Read-only storage access

**Associated Test File**: [`src/test_emergency_recovery.rs`](../src/test_emergency_recovery.rs)

---
