# Implementation Summary: Nonce-Based Replay Protection for Operator Actions

## Branch

`add-nonce-based-replay-protection-for-operator-actions`

## Objective

Implement nonce-based replay protection for operator-authorized operations to prevent replay attacks and ensure that operator actions can only be executed once.

## Changes Made

### 1. Core Implementation (stellar-contracts/src/lib.rs)

#### Storage Key Addition

```rust
OperatorNonce(Address)  // Tracks nonce per operator in instance storage
```

#### Error Codes Added

```rust
InvalidNonce = 901,  // Nonce is too high (future nonce)
StaleNonce = 902,    // Nonce is too low (already used/replay attempt)
```

#### New Functions

- `get_operator_nonce(env: Env, operator: Address) -> u64`
  - Public function to query the current nonce for an operator
  - Returns 0 for operators that haven't performed any actions yet

- `validate_and_increment_nonce(env: &Env, operator: &Address, provided_nonce: u64) -> Result<(), Error>`
  - Internal function that validates the provided nonce matches the expected value
  - Increments the nonce atomically after successful validation
  - Publishes a "nonce_inc" event for monitoring
  - Returns `StaleNonce` error if nonce is too low (replay attempt)
  - Returns `InvalidNonce` error if nonce is too high (skipped ahead)

#### Updated Functions

- `heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error>`
  - **BREAKING CHANGE**: Added `nonce: u64` parameter
  - Now validates nonce before updating heartbeat timestamp
  - Ensures replay protection for all operator heartbeat operations

### 2. Comprehensive Test Suite (stellar-contracts/src/test.rs)

Added 13 comprehensive tests:

1. **test_operator_nonce_starts_at_zero** - Initial state verification
2. **test_heartbeat_with_valid_nonce_succeeds** - Normal operation flow
3. **test_heartbeat_with_stale_nonce_fails** - Replay attack prevention
4. **test_heartbeat_with_future_nonce_fails** - Invalid nonce rejection
5. **test_heartbeat_replay_attack_prevented** - Full replay scenario
6. **test_nonce_is_per_operator** - Per-operator isolation
7. **test_nonce_increments_monotonically** - Sequential increment verification
8. **test_nonce_skipping_not_allowed** - Gap prevention
9. **test_nonce_persists_across_operator_deactivation** - Persistence testing
10. **test_duplicate_nonce_rejected** - Duplicate detection
11. **test_nonce_validation_before_heartbeat_update** - Validation order
12. **test_non_operator_cannot_use_nonce** - Authorization check
13. **test_concurrent_operators_independent_nonces** - Multi-operator scenarios

### 3. Documentation Updates

#### ERROR_CODES.md

- Added new error codes: InvalidNonce (901), StaleNonce (902)
- Added missing error codes: NotOperator (205), AddressDenied (309), RescueForbidden (310), NoFeesToWithdraw (402)
- Organized error codes by category (900 series for Replay Protection)

#### NONCE_REPLAY_PROTECTION.md (New)

Comprehensive documentation including:

- Overview of the implementation
- Detailed explanation of all changes
- Security properties and guarantees
- Usage examples
- Migration guide for clients
- Error handling instructions
- Monitoring and observability recommendations

#### verify_nonce_implementation.sh (New)

Automated verification script that checks:

- Storage key presence
- Error code definitions
- Function implementations
- Test coverage
- Documentation completeness

## Acceptance Criteria Status

✅ **Require monotonically increasing nonce for operator actions**

- Implemented in `validate_and_increment_nonce` function
- Nonces must increment by exactly 1 for each operation
- No gaps or skips allowed

✅ **Persist and validate nonce per operator**

- Nonces stored in instance storage with `DataKey::OperatorNonce(Address)`
- Each operator has independent nonce counter
- Nonces persist across operator deactivation/reactivation
- Validation occurs before any state changes

✅ **Reject stale or duplicate nonces**

- Stale nonces (already used) rejected with `Error::StaleNonce`
- Future nonces (skipped) rejected with `Error::InvalidNonce`
- Duplicate nonces are a subset of stale nonces and are rejected

✅ **Add tests covering replay attempts**

- 13 comprehensive tests added
- Tests cover replay attacks, stale nonces, future nonces, and edge cases
- Tests verify per-operator isolation and concurrent operations
- Tests ensure validation happens before state changes

## Security Properties

### Replay Attack Prevention

- Nonces must increase monotonically (by exactly 1)
- Only the current expected nonce is accepted
- Stale nonces are immediately rejected
- Future nonces are rejected to prevent gaps

### Per-Operator Isolation

- Each operator has independent nonce counter
- Multiple operators can operate concurrently
- Nonces persist across operator status changes

### State Consistency

- Nonce validation occurs before state changes
- Failed validation does not update heartbeat
- Nonce increments are atomic with operations
- Events published for auditability

## Breaking Changes

### Function Signature Change

**Before:**

```rust
pub fn heartbeat(env: Env, operator: Address) -> Result<(), Error>
```

**After:**

```rust
pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error>
```

### Client Migration Required

All clients calling `heartbeat()` must:

1. Track the current nonce for each operator (starts at 0)
2. Increment the nonce after each successful call
3. Handle `StaleNonce` and `InvalidNonce` errors
4. Implement nonce recovery logic for failures

## Testing

### Verification

Run the verification script:

```bash
./verify_nonce_implementation.sh
```

### Unit Tests

Run the test suite:

```bash
cd stellar-contracts
cargo test --lib nonce
```

### Full Test Suite

Run all tests:

```bash
cd stellar-contracts
cargo test --lib
```

## Deployment Checklist

- [ ] Review all code changes
- [ ] Run full test suite and verify all tests pass
- [ ] Deploy to test environment
- [ ] Verify nonce behavior in test environment
- [ ] Update client applications with new signature
- [ ] Test client applications in test environment
- [ ] Monitor for nonce-related errors
- [ ] Deploy to production
- [ ] Monitor production metrics

## Monitoring Recommendations

### Events to Monitor

- `nonce_inc` events - Track nonce increments per operator
- `heartbeat` events - Track operator activity

### Metrics to Track

1. **Nonce Errors**: Count of `StaleNonce` and `InvalidNonce` errors
2. **Replay Attempts**: Monitor `StaleNonce` errors as potential attacks
3. **Operator Activity**: Track heartbeat frequency per operator
4. **Nonce Gaps**: Detect if nonces are being skipped (should never happen)

### Alerts to Configure

- High rate of `StaleNonce` errors (potential replay attack)
- Any `InvalidNonce` errors (indicates client logic error)
- Operator nonce not incrementing (indicates stuck client)

## Files Changed

1. **stellar-contracts/src/lib.rs** - Core implementation
2. **stellar-contracts/src/test.rs** - Test suite
3. **ERROR_CODES.md** - Error code documentation
4. **NONCE_REPLAY_PROTECTION.md** - Implementation documentation
5. **verify_nonce_implementation.sh** - Verification script

## Commit Information

**Branch**: `add-nonce-based-replay-protection-for-operator-actions`

**Commit Message**:

```
Add nonce-based replay protection for operator actions

Implements monotonically increasing nonce validation for operator-authorized
operations to prevent replay attacks.
```

## Next Steps

1. **Code Review**: Have the implementation reviewed by team members
2. **Testing**: Run full test suite to ensure all tests pass
3. **Client Updates**: Update all operator clients to use new signature
4. **Documentation**: Share NONCE_REPLAY_PROTECTION.md with operators
5. **Deployment**: Deploy to test environment first, then production
6. **Monitoring**: Set up alerts and dashboards for nonce metrics

## References

- Issue: Add nonce-based replay protection for operator actions
- Documentation: NONCE_REPLAY_PROTECTION.md
- Error Codes: ERROR_CODES.md
- Tests: stellar-contracts/src/test.rs (lines 1383-1680)
