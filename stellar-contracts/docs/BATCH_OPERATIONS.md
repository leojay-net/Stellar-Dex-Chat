# Batch Operations Guide

This guide provides comprehensive documentation on batch operations in the Stellar Fiat Bridge contract, including both **batch admin operations** and **escrow migration batch processing**.

## Overview

The contract supports two types of batch operations:

1. **Batch Admin Operations** (`execute_batch_admin`): Atomic execution of multiple administrative state changes
2. **Escrow Migration Batching** (`migrate_escrow`): Cursor-based pagination for large dataset migrations

Both systems are designed to:
- Stay within Stellar's transaction size and computational limits
- Maintain consistency through careful state management
- Provide visibility through events and result structs
- Support resumption and monitoring in production

---

## Table of Contents

1. [Batch Admin Operations](#batch-admin-operations)
2. [Escrow Migration Batching](#escrow-migration-batching)
3. [Event System](#event-system)
4. [Error Handling](#error-handling)
5. [Best Practices](#best-practices)
6. [Performance Tuning](#performance-tuning)

---

## Batch Admin Operations

### Purpose

The `execute_batch_admin` function allows the contract admin to execute multiple administrative operations in a single transaction. This is more efficient than calling individual admin functions separately, as it:

- Reduces transaction count and associated fees
- Executes operations in a defined order
- Provides atomic visibility (all operations' state changes are applied before the transaction completes)
- Maintains a detailed record of partial failures

### Function Signature

```rust
pub fn execute_batch_admin(
    env: Env,
    operations: Vec<BatchAdminOp>,
) -> Result<BatchResult, Error>
```

### Data Structures

#### `BatchAdminOp`

Each operation in a batch is represented as:

```rust
pub struct BatchAdminOp {
    pub op_type: Symbol,    // Operation identifier (e.g., "set_cooldown")
    pub payload: Bytes,     // Operation-specific data (binary encoded)
}
```

The `op_type` is a symbol naming the operation, and `payload` contains operation-specific parameters.

#### `BatchResult`

The function returns a detailed result struct:

```rust
pub struct BatchResult {
    pub total_ops: u32,           // Total operations submitted
    pub success_count: u32,       // Number of successfully executed operations
    pub failure_count: u32,       // Number of failed operations
    pub failed_index: Option<u32>, // Index (0-based) of the FIRST failure, or None if all succeeded
}
```

**Key properties:**
- `success_count + failure_count == total_ops` (always)
- `failed_index` points to the index of the **first** operation that failed
- If `failure_count == 0`, then `failed_index == None`
- If any operation fails, remaining operations still execute (no early abort)

### Supported Operations

#### Set Cooldown Period

**Symbol:** `"set_cooldown"`  
**Payload:** 4-byte big-endian unsigned integer (u32)  
**Effect:** Sets the cooldown period in ledgers before a withdrawal can complete

```rust
// Example: Set 100-ledger cooldown
let payload = Bytes::from_array(&env, &100u32.to_be_bytes());
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_cooldown"),
    payload,
});
```

#### Set Lock Period

**Symbol:** `"set_lock"`  
**Payload:** 4-byte big-endian unsigned integer (u32)  
**Effect:** Sets the minimum lock period in ledgers for escrowed funds

```rust
// Example: Set 50-ledger lock period
let payload = Bytes::from_array(&env, &50u32.to_be_bytes());
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_lock"),
    payload,
});
```

#### Set Withdrawal Quota

**Symbol:** `"set_quota"`  
**Payload:** 16-byte big-endian signed integer (i128)  
**Effect:** Sets the per-user daily withdrawal quota

```rust
// Example: Set 1000 XLM daily quota
let quota: i128 = 1_000_000_000; // in stroops
let payload = Bytes::from_array(&env, &quota.to_be_bytes());
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_quota"),
    payload,
});
```

#### Set Anti-Sandwich Delay

**Symbol:** `"set_sandwich"`  
**Payload:** 4-byte big-endian unsigned integer (u32)  
**Effect:** Sets the delay in ledgers before a deposit can be withdrawn to prevent sandwich attacks

```rust
// Example: Set 3-ledger anti-sandwich delay
let payload = Bytes::from_array(&env, &3u32.to_be_bytes());
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_sandwich"),
    payload,
});
```

#### Pause Contract

**Symbol:** `"pause"`  
**Payload:** Empty (0 bytes)  
**Effect:** Pauses all user deposits and withdrawals

```rust
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "pause"),
    payload: Bytes::new(&env),
});
```

#### Unpause Contract

**Symbol:** `"unpause"`  
**Payload:** Empty (0 bytes)  
**Effect:** Resumes all user deposits and withdrawals

```rust
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "unpause"),
    payload: Bytes::new(&env),
});
```

### Execution Semantics

The batch execution follows these rules:

1. **Authorization**: The caller must be the contract admin; `admin.require_auth()` is called
2. **Sequential Processing**: Operations are processed in the order they appear in the vector
3. **Non-Atomic with Respect to Failures**: 
   - If operation N fails, operations N+1, N+2, ... are still executed
   - Successfully executed operations' state changes persist even if a later operation fails
   - This is **NOT** a transaction rollback scenario
4. **Error Recording**: When an operation fails:
   - The failure is recorded (failure_count incremented)
   - `BatchFailEvent` is emitted with the operation index
   - Execution continues
5. **Multiple Failures**: If operations at indices 2, 5, and 7 fail:
   - `failed_index == 2` (the **first** failure)
   - `failed_index != 5` and `failed_index != 7` (only the first is recorded)
   - All three failures are reflected in `failure_count`

### Example: Batch Configuration Update

```rust
// Create a batch that updates multiple config parameters
let mut ops = soroban_sdk::Vec::new(&env);

// 1. Set cooldown to 100 ledgers
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_cooldown"),
    payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
});

// 2. Set lock period to 50 ledgers
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_lock"),
    payload: Bytes::from_array(&env, &50u32.to_be_bytes()),
});

// 3. Set withdrawal quota to 10 XLM
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_quota"),
    payload: Bytes::from_array(&env, &(10_000_000_000i128).to_be_bytes()),
});

// 4. Set anti-sandwich delay to 3 ledgers
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_sandwich"),
    payload: Bytes::from_array(&env, &3u32.to_be_bytes()),
});

// Execute the batch
let result = bridge.execute_batch_admin(&ops)?;

// Check results
assert_eq!(result.total_ops, 4);
assert_eq!(result.success_count, 4);
assert_eq!(result.failure_count, 0);
assert!(result.failed_index.is_none());
```

### Example: Batch with Mixed Success/Failure

```rust
let mut ops = soroban_sdk::Vec::new(&env);

// Valid operation
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_cooldown"),
    payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
});

// Invalid operation (malformed payload - too short)
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_lock"),
    payload: Bytes::new(&env), // Missing required 4 bytes!
});

// Another valid operation (will still execute)
ops.push_back(BatchAdminOp {
    op_type: Symbol::new(&env, "set_sandwich"),
    payload: Bytes::from_array(&env, &3u32.to_be_bytes()),
});

let result = bridge.execute_batch_admin(&ops)?;

// Result interpretation:
// - result.total_ops == 3
// - result.success_count == 2 (ops 0 and 2 succeeded)
// - result.failure_count == 1 (op 1 failed)
// - result.failed_index == Some(1) (op at index 1 failed first)
//
// Contract state will reflect:
// - Cooldown period set to 100
// - Lock period unchanged (op 1 failed)
// - Anti-sandwich delay set to 3
```

---

## Escrow Migration Batching

### Purpose

The `migrate_escrow` function performs cursor-based batch migration of escrow records from legacy storage to a versioned schema. This pattern enables:

- Gradual migration of potentially millions of records
- Resumable operations (call multiple times until complete)
- Idempotent behavior (safe to retry failed batches)
- Fine-grained control over resource consumption
- Event-based progress tracking

### Function Signature

```rust
pub fn migrate_escrow(env: Env, batch_size: u32) -> Result<u32, Error>
```

### Parameters and Returns

- **`batch_size`**: Maximum number of records to migrate in this call
  - Range: 1 to ~1000 (depends on Stellar's transaction limits)
  - Recommended: 10-100 for safety, 100-1000 for speed
- **Returns**: `Ok(u32)` - Number of records actually migrated in this batch
- **Errors**:
  - `Error::MigrationAlreadyComplete`: Storage version is already at target
  - `Error::NotAuthorized`: Caller is not the contract admin
  - `Error::NotInitialized`: Contract has not been initialized

### Migration State

The contract maintains migration state in instance storage:

```rust
pub fn get_escrow_storage_version(env: Env) -> u32
pub fn get_migration_cursor(env: Env) -> u64
```

- **Storage Version**: Indicates current schema version
  - Value 0: Legacy schema (pre-migration)
  - Value 1: Current versioned schema
- **Migration Cursor**: Tracks progress
  - Value from 0 to total record count
  - Incremented as records are processed
  - Used to resume from failure point

### Migration Process

Each call to `migrate_escrow` follows this process:

1. **Verify Authorization**: Check caller is admin; `admin.require_auth()` called
2. **Check Completion**: Return error if already migrated
3. **Get Cursor**: Retrieve current migration progress position
4. **Process Records**: Iterate up to `batch_size` records:
   - Look up receipt hash from temporary index
   - Retrieve receipt from persistent storage
   - Create new `EscrowRecord` with metadata
   - Store in persistent storage
5. **Update Cursor**: Advance cursor past processed records
6. **Mark Complete** (if done): Set storage version to ESCROW_STORAGE_VERSION
7. **Emit Event**: Publish `MigrationEvent` with progress information

### Data Structures

#### `EscrowRecord`

The versioned escrow record:

```rust
pub struct EscrowRecord {
    pub version: u32,       // Schema version (currently 1)
    pub depositor: Address, // Address of original depositor
    pub token: Address,     // Token contract address
    pub amount: i128,       // Escrowed amount in token units
    pub ledger: u32,        // Ledger number when escrow was created
    pub migrated: bool,     // Flag indicating migration completed
}
```

### Execution Pattern

The typical migration pattern is:

```rust
// 1. Start migration with batch size of 100
let batch1 = bridge.migrate_escrow(&env, 100)?;
println!("Migrated {} records", batch1); // e.g., "Migrated 100 records"

// 2. Continue with next batch
let batch2 = bridge.migrate_escrow(&env, 100)?;
println!("Migrated {} records", batch2); // e.g., "Migrated 100 records"

// 3. Keep calling until fewer records migrated than batch_size
//    (indicates we've reached the end)
loop {
    let count = bridge.migrate_escrow(&env, 100)?;
    if count < 100 {
        println!("Final batch: {} records", count);
        break;
    }
}

// 4. Verify migration is complete
let version = bridge.get_escrow_storage_version(&env);
if version == 1 {
    println!("Migration complete!");
}
```

### Idempotency and Safety

- **Idempotent**: Calling after migration is complete returns `Error::MigrationAlreadyComplete`
- **Resumable**: If a batch fails, call again; the cursor ensures progress is not lost
- **No Data Loss**: Records are not deleted, only transformed to new schema
- **Async Friendly**: Can be called from background jobs or scheduled tasks

---

## Event System

### Batch Operation Events

When executing batch admin operations, the contract emits events:

#### `BatchOkEvent` (All operations succeeded)

Emitted when `execute_batch_admin` completes with no failures.

```rust
pub struct BatchOkEvent {
    pub version: u32,           // Event schema version (v1)
    pub success_count: u32,     // Number of successful operations
    pub failure_count: u32,     // Number of failures (0 for this event)
    pub total_ops: u32,         // Total operations processed
}
```

**Event Topics**: `(Symbol::short("batch_ok"), Symbol::short("v1"))`

#### `BatchFailEvent` (Individual operation failure)

Emitted **for each individual operation that fails** during batch execution.

```rust
pub struct BatchFailEvent {
    pub version: u32,           // Event schema version (v1)
    pub index: u32,             // 0-based index of the failed operation
    pub total_ops: u32,         // Total operations in the batch
}
```

**Event Topics**: `(Symbol::short("batch_fail"), Symbol::short("v1"))`

**Note**: If a batch has 5 operations and ops 1, 3, and 4 fail, you'll see three `BatchFailEvent`s (one for each failure) plus one `BatchOkEvent` (at the end, now potentially misleading - consider using `failure_count` from `BatchResult` instead).

### Migration Events

#### `MigrationEvent`

Emitted after each `migrate_escrow` call.

```rust
pub struct MigrationEvent {
    pub version: u32,           // Event schema version (v1)
    pub cursor: u64,            // Current cursor position after this batch
    pub migrated_count: u32,    // Number of records migrated in this batch
}
```

**Event Topics**: `(Symbol::short("migration"), Symbol::short("v1"))`

**Usage**: Indexers can subscribe to `migration` events to track progress in real-time.

---

## Error Handling

### Batch Operation Errors

Operations fail silently in terms of execution flow, but are recorded in the `BatchResult`. Important error scenarios:

| Condition | Handling | Result |
|-----------|----------|--------|
| Malformed payload (too short) | Operation fails | Counted in `failure_count` |
| Unknown operation type | Operation fails | Counted in `failure_count` |
| Other operation error | Operation fails | Counted in `failure_count` |
| Unauthorized admin | Function returns error | Entire batch aborted |
| Not initialized | Function returns error | Entire batch aborted |

### Migration Errors

| Error | Meaning | Recovery |
|-------|---------|----------|
| `MigrationAlreadyComplete` | Already migrated once | Check `get_escrow_storage_version()` == 1 |
| `NotAuthorized` | Caller is not admin | Ensure caller is the admin address |
| `NotInitialized` | Contract not initialized | Initialize contract first |

---

## Best Practices

### Batch Admin Operations

1. **Validate Payloads**: Ensure all payloads are correctly encoded before submitting
   ```rust
   // Good: Explicit payload validation
   let cooldown_bytes = Bytes::from_array(&env, &cooldown.to_be_bytes());
   assert_eq!(cooldown_bytes.len(), 4, "Invalid cooldown payload");
   ```

2. **Check Results**: Always inspect `BatchResult` for failures
   ```rust
   let result = bridge.execute_batch_admin(&ops)?;
   if result.failure_count > 0 {
       eprintln!("Batch had {} failures; first at index {}", 
           result.failure_count, 
           result.failed_index.unwrap());
   }
   ```

3. **Order Operations Carefully**: Later operations depend on earlier state
   ```rust
   // If setting related parameters, consider order:
   // 1. Set limits first
   // 2. Then set related periods
   // This ensures consistent state throughout the batch
   ```

4. **Monitor Events**: Use batch events to diagnose failures
   ```
   // Query emitted events to determine:
   // - Which operations failed
   // - When the batch completed
   ```

5. **Batch Size Conservatism**: Start with smaller batches to understand resource usage
   ```rust
   // Test with small batch first
   let test_result = bridge.execute_batch_admin(&test_ops)?;
   assert_eq!(test_result.success_count, test_ops.len() as u32);
   
   // Then scale up if needed
   ```

### Escrow Migration

1. **Choose Appropriate Batch Size**: 
   - For initial testing: 10-50 records
   - For production with millions: 100-500 records
   - For rapid completion: 500-1000 records
   ```rust
   // Monitor gas per record to choose optimal size
   let batch1 = bridge.migrate_escrow(&env, 50)?;
   // Check gas usage, then adjust batch_size for subsequent calls
   ```

2. **Implement Resumption Logic**: Handle partial progress gracefully
   ```rust
   // Loop until completion
   loop {
       match bridge.migrate_escrow(&env, 100) {
           Ok(count) => {
               if count == 0 { break; } // No more records
               log!("Migrated {} records", count);
           }
           Err(Error::MigrationAlreadyComplete) => {
               log!("Migration already complete");
               break;
           }
           Err(e) => return Err(e),
       }
   }
   ```

3. **Monitor Progress**: Track cursor position and emit telemetry
   ```rust
   let cursor = bridge.get_migration_cursor(&env);
   let total = bridge.get_receipt_counter(&env); // if available
   let progress_pct = (cursor as f64 / total as f64) * 100.0;
   log!("Migration progress: {:.1}%", progress_pct);
   ```

4. **Verify Completion**: Always check storage version
   ```rust
   let version = bridge.get_escrow_storage_version(&env);
   assert_eq!(version, 1, "Migration did not complete");
   ```

---

## Performance Tuning

### Batch Admin Operations

- **Transaction Size**: Each operation adds ~50-100 bytes; 100 operations ≈ 5-10 KB
- **CPU Cycles**: Minimal for config operations; dominated by state writes
- **Typical Cost**: 1-2 Stellar base fees regardless of batch size (amortizes cost)

### Escrow Migration

- **Gas per Record**: ~500-1000 units depending on record complexity
- **Recommended Batches**:
  | Total Records | Batch Size | Est. Batches | Strategy |
  |---------------|-----------|---------------|----------|
  | < 1,000 | 100 | 10 | Can run all in one transaction set |
  | 1,000-10,000 | 200 | 50-100 | Run during low-traffic periods |
  | 10,000-1M | 500 | 2,000-20,000 | Background job with pacing |

- **Monitoring**: Use `MigrationEvent` emissions to establish baseline
  ```
  If 100 records take 500K units of gas:
  - 1M records = 5B units (may exceed limits)
  - Consider batching to 50-100 records per call
  ```

---

## Summary

- **Batch Admin Operations**: Efficiently execute multiple config changes; operations continue on failure
- **Escrow Migration**: Safely migrate large datasets in resumable, paced batches
- **Events**: Enable real-time monitoring and debugging
- **Execution**: Non-atomic at the operation level but atomic at the transaction level
- **Errors**: Recorded and reported, never cause silent failures

For further details, see [VERSION_MIGRATION.md](./VERSION_MIGRATION.md).
