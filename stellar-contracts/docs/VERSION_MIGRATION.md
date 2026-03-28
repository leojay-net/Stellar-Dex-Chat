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

## Escrow Storage Migration

### Storage Version: 1

Escrow records are versioned to support safe migrations during contract upgrades.

### Migration Process

1. Call `migrate_escrow(batch_size)` with appropriate batch size
2. Migration is resumable - call multiple times until complete
3. Check `get_escrow_storage_version()` to verify completion
4. Migration is idempotent - repeated calls after completion return error

### Migration API

```rust
// Check current storage version
fn get_escrow_storage_version(env: Env) -> u32

// Migrate escrow records in batches
fn migrate_escrow(env: Env, batch_size: u32) -> Result<u32, Error>

// Get migration progress cursor
fn get_migration_cursor(env: Env) -> u64

// Retrieve migrated escrow record
fn get_escrow_record(env: Env, id: u64) -> Option<EscrowRecord>
```

### EscrowRecord Schema

```rust
pub struct EscrowRecord {
    pub version: u32,
    pub depositor: Address,
    pub token: Address,
    pub amount: i128,
    pub ledger: u32,
    pub migrated: bool,
}
```

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

## Batched Admin Operations

### Atomic Batch Execution

Admin operations can be executed atomically with automatic rollback on failure.

### Supported Operations

| Operation | Symbol | Payload |
|-----------|--------|---------|
| Set cooldown | set_cooldown | u32 (big-endian) |
| Set lock period | set_lock | u32 (big-endian) |
| Set withdrawal quota | set_quota | i128 (big-endian) |
| Set anti-sandwich delay | set_sandwich | u32 (big-endian) |

### Usage

```rust
let mut ops = Vec::new(&env);
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_cooldown"),
    payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
});
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_lock"),
    payload: Bytes::from_array(&env, &50u32.to_be_bytes()),
});

let result = bridge.execute_batch_admin(&ops);
```

### Rollback Behavior

- All operations are applied in order
- If any operation fails, all changes are reverted
- State is restored to pre-batch values
- Event emitted indicates success or failure index
