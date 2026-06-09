# Version Migration Strategy

## Event Versioning

All contract events include a version identifier to ensure indexer compatibility during protocol upgrades.

### Current Version: v1

Events are emitted with a version symbol (e.g., `v1`) in the topic tuple:

```rust
env.events().publish(
    (Symbol::new(&env, "deposit"), Symbol::new(&env, "v1"), from),
    amount,
);
```

### Version Migration Guidelines

1. When modifying event schemas, increment the version (v1 -> v2)
2. Maintain backward-compatible schemas when possible
3. Document breaking changes in release notes
4. Indexers should filter by version to handle schema differences

### Versioned Events

| Event | Version | Topics | Data |
|-------|---------|--------|------|
| deposit | v1 | (event_name, version, depositor) | amount |
| withdraw | v1 | (event_name, version, recipient) | amount |
| rcpt_issd | v1 | (event_name, version) | receipt_id |
| slippage | v1 | (event_name, version) | slippage_bps |
| quota_set | v1 | (event_name, version) | quota |
| migration | v1 | (event_name, version) | (cursor, count) |
| batch_ok | v1 | (event_name, version) | (success_count, total_ops) |
| batch_fail | v1 | (event_name, version) | (failed_index, total_ops) |

---

## Governed Upgrade Mechanism

Contract upgrades follow a two-phase commit pattern to prevent surprise
upgrades and give observers time to audit new bytecode.

### Phase 1 — Propose

```rust
// Admin proposes a new WASM hash with a mandatory delay.
// delay must be >= MIN_UPGRADE_DELAY (1 000 ledgers ≈ 83 minutes).
fn propose_upgrade(env: Env, wasm_hash: BytesN<32>, delay: u32) -> Result<(), Error>
```

**Overflow prevention:** `executable_after = current_ledger + delay` is
computed with `checked_add`.  If the sum would overflow `u32`, the call
returns `Error::Overflow` rather than wrapping to a value in the past (which
would allow an immediate upgrade bypass).

### Phase 2 — Execute

```rust
// Admin executes the upgrade after the timelock has elapsed.
// Fails with Error::UpgradeNotReady if current_ledger <= executable_after.
fn execute_upgrade(env: Env) -> Result<(), Error>
```

**Boundary check:** The readiness check uses strict `>` (not `>=`), adding
one extra ledger of safety margin consistent with the rest of the timelock
pattern.

### Cancel

```rust
// Admin cancels a pending proposal without executing it.
fn cancel_upgrade(env: Env) -> Result<(), Error>
```

### Query

```rust
// Returns the pending proposal, or None if no upgrade is pending.
fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal>

// Returns the configured minimum upgrade delay (default: MIN_UPGRADE_DELAY).
fn get_upgrade_delay(env: Env) -> u32

// Admin can update the minimum delay.
fn set_upgrade_delay(env: Env, delay: u32) -> Result<(), Error>
```

### Error Codes

| Error | Code | Condition |
|-------|------|-----------|
| `UpgradeDelayTooShort` | 607 | `delay < MIN_UPGRADE_DELAY` |
| `UpgradeProposalMissing` | 606 | No pending proposal |
| `UpgradeNotReady` | 605 | Timelock has not elapsed |
| `Overflow` | 10 | `current_ledger + delay` overflows `u32` |

---

## Admin Action Timelock

All privileged governance operations follow a mandatory two-phase commit pattern to prevent surprise changes and give observers time to react.

### General Pattern

```rust
// Phase 1: Queue an action with a mandatory minimum delay
fn queue_admin_action(env: Env, action_type: Symbol, payload: Bytes, delay: u32) -> Result<u64, Error>

// Phase 2: Execute a queued action once the timelock has elapsed
fn execute_admin_action(env: Env, id: u64) -> Result<(), Error>
```

**Minimum delay:** `delay` must be at least `MIN_TIMELOCK_DELAY` = 34,560 ledgers ≈ 48 hours.
Shorter delays are rejected with `Error::ActionNotReady`.

**Boundary check:** Execution requires `current_ledger > target_ledger` (strict `>`), adding one extra ledger of safety margin.

### Admin Renounce Pattern

The `queue_renounce_admin` / `execute_renounce_admin` functions follow the same timelock pattern but are irreversible:
once renounce is executed, the admin address is permanently removed and no further governance is possible.

```rust
// Queue irreversible admin renounce under timelock
fn queue_renounce_admin(env: Env) -> Result<(), Error>

// Complete renounce after timelock elapses (permanent)
fn execute_renounce_admin(env: Env) -> Result<(), Error>
```

**Pause requirement:** Renounce queueing is blocked while the contract is paused, preventing the timelock from elapsing and leaving the contract permanently without governance.

---

## Overflow Prevention

See [OVERFLOW_PREVENTION.md](./OVERFLOW_PREVENTION.md) for a comprehensive
guide to the overflow-prevention strategies used throughout the contract,
including the upgrade mechanism, accumulator fields, and fixed-point math.

---

## Escrow Storage Migration

### Storage Version: 1

Escrow records are versioned to support safe migrations during contract upgrades. This mechanism allows the contract to evolve its storage schema without breaking existing data.

### Architecture Overview

The migration system uses a **cursor-based batch processing** approach to safely migrate large datasets without exceeding Stellar's transaction limits. Key architectural components:

1. **Storage Version Tracking**: A version number stored in instance storage indicates the current schema version
2. **Migration Cursor**: Tracks progress through the dataset, enabling resumable migrations
3. **Batch Processing**: Processes records in configurable batch sizes to stay within resource limits
4. **Event Emission**: Publishes progress events for monitoring and indexing

### Migration Health Check

Before initiating or resume a migration, administrators should perform a health check to understand the current state of the escrow dataset.

#### Step 1: Check Current Version
Query `get_escrow_storage_version()` to determine if the migration is already complete.
- **Version 0**: Migration not started or in progress.
- **Version 1**: Migration successfully completed.

#### Step 2: Assess Progress
Query `get_migration_cursor()` to see the last processed record ID.
Compare this with the total number of receipts (available via indexers or contract logs) to estimate remaining work.

#### Step 3: Verify Integrity (Optional)
Spot-check specific records using `get_escrow_record(id)`.
- If `Some(record)` is returned, the record has been migrated.
- If `None` is returned, the record is either missing or hasn't been reached by the cursor yet.

---

### Migration API

```rust
/// Migrates escrow records from legacy storage to versioned schema
///
/// # Arguments
/// * `env` - The contract environment
/// * `batch_size` - Maximum number of records to migrate in this call
///
/// # Returns
/// * `Ok(u32)` - Number of records migrated in this batch
/// * `Err(Error)` - Migration error (e.g., already complete, not authorized)
///
/// # Behavior
/// - Processes records starting from the current cursor position
/// - Updates cursor after each batch to enable resumption
/// - Sets storage version to target version when migration completes
/// - Emits migration event with progress information
///
/// # Example
/// ```rust
/// // Migrate 100 records at a time
/// let migrated = bridge.migrate_escrow(&env, 100)?;
/// println!("Migrated {} records", migrated);
/// ```
fn migrate_escrow(env: Env, batch_size: u32) -> Result<u32, Error>

/// Retrieves the current escrow storage version
///
/// # Returns
/// * `u32` - Current storage version (0 if never migrated)
fn get_escrow_storage_version(env: Env) -> u32

/// Gets the current migration progress cursor
///
/// # Returns
/// * `u64` - The last processed record ID (0 if not started)
fn get_migration_cursor(env: Env) -> u64

/// Retrieves a migrated escrow record by ID
///
/// # Arguments
/// * `env` - The contract environment
/// * `id` - The record ID to retrieve
///
/// # Returns
/// * `Some(EscrowRecord)` - The migrated record if it exists
/// * `None` - Record not found or not yet migrated
fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord>
```

### EscrowRecord Schema

```rust
/// Versioned escrow record with migration metadata
///
/// # Fields
/// * `version` - Schema version of this record
/// * `depositor` - Address of the original depositor
/// * `token` - Token address for the escrowed amount
/// * `amount` - Escrowed amount in token units
/// * `ledger` - Stellar ledger number when escrow was created
/// * `migrated` - Flag indicating if this record has been migrated
pub struct EscrowRecord {
    pub version: u32,
    pub depositor: Address,
    pub token: Address,
    pub amount: i128,
    pub ledger: u32,
    pub migrated: bool,
}
```

### Migration Event

The contract emits a migration event after each batch:

```rust
pub struct MigrationEvent {
    pub version: u32,        // Event schema version
    pub cursor: u64,         // Current migration cursor position
    pub migrated_count: u32, // Number of records migrated in this batch
}
```

**Event topics**: `(Symbol::short("migration"), Symbol::short("v1"))`

### Error Handling

| Error | Code | Condition |
|-------|------|-----------|
| `MigrationAlreadyComplete` | 608 | Storage version already at target |
| `NotAuthorized` | 403 | Caller is not admin |
| `NotInitialized` | 500 | Contract not initialized |

### Performance Considerations

- **Batch Size**: Choose based on expected record count and resource limits
  - Small batches (10-100): Safer for large datasets, more events
  - Large batches (100-1000): Fewer events, faster completion
- **Gas Costs**: Each record migration consumes gas; monitor during testing
- **Idempotency**: Safe to call multiple times; will skip already-migrated records
- **Monitoring**: Use migration events to track progress in production

## Withdrawal Quota System

### Daily Quota Enforcement

Per-user daily withdrawal limits tracked with 24-hour rolling windows (~17,280 ledgers).

### Configuration

```rust
// Set daily withdrawal quota (admin only)
fn set_withdrawal_quota(env: Env, quota: i128) -> Result<(), Error>

// Query current quota
fn get_withdrawal_quota(env: Env) -> i128

// Query user's withdrawn amount in current window
fn get_user_daily_withdrawal(env: Env, user: Address) -> i128
```

### Behavior

- Quota of 0 disables enforcement
- Window resets after 17,280 ledgers (~24 hours)
- Quota is per-user, tracked independently

---

## Daily Deposit Limit

### Per-Token Daily Deposit Limit Enforcement

Per-user per-token daily deposit limits are enforced with 24-hour rolling windows (~17,280 ledgers).
This complements the global fiat limit and withdrawal quota, providing multi-layer rate limiting.

### Configuration

```rust
// Set daily deposit limit for a specific token (admin only)
fn set_daily_deposit_limit(env: Env, token: Address, limit_per_day: i128) -> Result<(), Error>
```

### Behavior

- Limit of 0 or negative value disables enforcement for that token
- Window resets after 17,280 ledgers (`WINDOW_LEDGERS`) — approximately 24 hours
- Limit is per-user per-token, tracked independently
- Deposits exceeding the limit are rejected with `Error::DailyLimitExceeded` (code 303)

### Storage

User deposit records are stored as `UserDailyDeposit` structs in instance storage,
keyed by `DataKey::UserDailyDeposit(depositor, token)`:

```rust
pub struct UserDailyDeposit {
    pub amount: i128,           // Total deposited in current window
    pub window_start: u32,      // Ledger when the current window opened
}
```

### Relation to Other Limits

- **Daily Deposit Limit** (this section): per-user per-token rolling cap, enforced on `deposit`
- **Withdrawal Quota** (previous section): per-user daily rollup cap, enforced on `withdraw` / `execute_withdrawal`
- **Fiat Limit** (`ExceedsFiatLimit`, code 304): per-user USD-cent daily cap, enforced on `deposit`

---

## Batched Admin Operations

### Overview

The `execute_batch_admin` function enables the contract admin to execute multiple administrative operations in a single transaction. While called atomically at the transaction level, individual operations are **not** rolled back if they fail; rather, they are skipped while execution continues.

For a comprehensive guide with examples and error handling patterns, see [BATCH_OPERATIONS.md](./BATCH_OPERATIONS.md).

### Supported Operations

| Operation | Symbol | Payload | Effect |
|-----------|--------|---------|--------|
| Set cooldown | `set_cooldown` | u32 (big-endian) | Sets cooldown period in ledgers |
| Set lock period | `set_lock` | u32 (big-endian) | Sets lock period in ledgers |
| Set withdrawal quota | `set_quota` | i128 (big-endian) | Sets daily withdrawal quota |
| Set anti-sandwich delay | `set_sandwich` | u32 (big-endian) | Sets anti-sandwich delay in ledgers |
| Pause | `pause` | (empty) | Pauses all user deposits/withdrawals |
| Unpause | `unpause` | (empty) | Resumes user deposits/withdrawals |

### Function Signature

```rust
pub fn execute_batch_admin(
    env: Env,
    operations: Vec<BatchAdminOp>,
) -> Result<BatchResult, Error>
```

### Data Structures

#### `BatchAdminOp`

```rust
pub struct BatchAdminOp {
    pub op_type: Symbol,   // Operation identifier
    pub payload: Bytes,    // Operation-specific parameters (binary encoded)
}
```

#### `BatchResult`

```rust
pub struct BatchResult {
    pub total_ops: u32,           // Total operations in batch
    pub success_count: u32,       // Successfully executed operations
    pub failure_count: u32,       // Failed operations
    pub failed_index: Option<u32>, // Index of first failure, or None if all succeeded
}
```

### Usage Example

```rust
let mut ops = soroban_sdk::Vec::new(&env);

// Operation 0: Set cooldown to 100 ledgers
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_cooldown"),
    payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
});

// Operation 1: Set lock period to 50 ledgers
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_lock"),
    payload: Bytes::from_array(&env, &50u32.to_be_bytes()),
});

// Operation 2: Pause the contract
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "pause"),
    payload: Bytes::new(&env),
});

let result = bridge.execute_batch_admin(&ops)?;

// Check results
if result.failure_count > 0 {
    eprintln!("Some operations failed. First failure at index: {:?}", 
        result.failed_index);
} else {
    println!("All {} operations succeeded", result.success_count);
}
```

### Execution Semantics

**Critical:** This is NOT a transactional rollback scenario. Understanding the execution semantics is essential:

1. **Sequential Processing**: Operations execute in order (index 0, 1, 2, ...)
2. **No Early Abort**: If operation N fails, operations N+1, N+2, ... still execute
3. **No State Rollback**: State changes from successful operations are **not** reverted if a later operation fails
4. **Error Recording**: Each failed operation is recorded in:
   - A `BatchFailEvent` is emitted immediately
   - `failure_count` is incremented
   - `failed_index` is set (if it's the first failure)

#### Example: Batch with Mixed Success/Failure

```rust
let mut ops = soroban_sdk::Vec::new(&env);

// Op 0: Valid
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_cooldown"),
    payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
});

// Op 1: Invalid - payload too short
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_lock"),
    payload: Bytes::new(&env),  // ERROR: needs 4 bytes!
});

// Op 2: Valid - still executes
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_sandwich"),
    payload: Bytes::from_array(&env, &3u32.to_be_bytes()),
});

let result = bridge.execute_batch_admin(&ops)?;

// Result interpretation:
assert_eq!(result.total_ops, 3);
assert_eq!(result.success_count, 2);  // ops 0 and 2 succeeded
assert_eq!(result.failure_count, 1);  // op 1 failed
assert_eq!(result.failed_index, Some(1));  // first failure at index 1

// Contract state:
// - Cooldown: set to 100 (from op 0)
// - Lock period: unchanged (op 1 failed, no effect)
// - Anti-sandwich delay: set to 3 (from op 2)
```

### Events

The contract emits events for detailed monitoring:

#### `BatchOkEvent` (Final event)

```rust
pub struct BatchOkEvent {
    pub version: u32,        // Event schema version
    pub success_count: u32,
    pub failure_count: u32,
    pub total_ops: u32,
}
```

**Topics**: `(Symbol::short("batch_ok"), Symbol::short("v1"))`

#### `BatchFailEvent` (Per-operation failure)

```rust
pub struct BatchFailEvent {
    pub version: u32,     // Event schema version
    pub index: u32,       // 0-based index of failed operation
    pub total_ops: u32,   // Total operations in batch
}
```

**Topics**: `(Symbol::short("batch_fail"), Symbol::short("v1"))`

**Note**: One `BatchFailEvent` is emitted for **each** operation that fails.

### Authorization

The `execute_batch_admin` function requires admin authorization:

```rust
admin.require_auth()  // Must be called by the contract admin
```

Returns `Error::NotInitialized` if contract is not initialized.

### Error Handling

| Condition | Handling | Recovery |
|-----------|----------|----------|
| Unknown operation type | Operation fails | Check operation type spelling |
| Malformed payload (too short) | Operation fails | Validate payload length before submission |
| Caller not admin | Entire batch aborted; returns error | Ensure caller is admin address |
| Contract not initialized | Entire batch aborted; returns error | Initialize contract first |

### Performance Considerations

- **Transaction Size**: Each operation adds ~50-100 bytes; 100 operations = ~5-10 KB
- **Gas Cost**: Minimal per operation; benefits from batching vs. individual calls
- **Fee Amortization**: One transaction fee covers all operations

### Best Practices

1. **Validate Payloads**: Ensure all payloads are correctly encoded before submitting
   ```rust
   assert_eq!(payload.len(), EXPECTED_SIZE, "Invalid payload size");
   ```

2. **Check Results**: Always inspect `BatchResult` for failures
   ```rust
   if result.failure_count > 0 {
       eprintln!("Operation at index {} failed", result.failed_index.unwrap());
   }
   ```

3. **Order Operations**: Consider dependencies when ordering operations
   - Set limits before related periods
   - Pause before major config changes
   - Unpause last in recovery batches

4. **Monitor Events**: Use batch events to diagnose failures in production

### See Also

- [BATCH_OPERATIONS.md](./BATCH_OPERATIONS.md): Comprehensive batch operations guide
- [ERROR_CODES.md](../ERROR_CODES.md): Complete error code reference
