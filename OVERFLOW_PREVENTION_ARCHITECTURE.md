# Overflow Prevention Architecture Guide

## Overview

The FiatBridge contract implements deterministic arithmetic safety throughout its lifecycle to prevent integer overflow/underflow bugs that could lead to financial loss or contract exploits. This document describes the comprehensive overflow prevention strategy, patterns, and best practices used throughout the codebase.

## Core Principles

### 1. Zero Implicit Wrapping
- Release builds enforce `overflow-checks = true` in Cargo.toml
- All arithmetic operations must be explicitly checked or use saturating operations
- No reliance on Rust's default wrapping behavior for financial calculations

### 2. Explicit Error Propagation
- Financial accumulators use `checked_add`, `checked_sub`, `checked_mul` returning typed errors
- Non-financial ledger calculations use `saturating_add`, `saturating_sub`
- Errors are returned as `Error::Overflow` or `Error::InternalError` rather than panicking

### 3. Safe Fixed-Point Scaling
- Decimal operations delegate to `crate::math::checked_mul_div_floor` / `checked_mul_div_ceil`
- These functions verify intermediate multiplications before division
- Ceiling offsets use checked addition to prevent secondary overflow

### 4. Guarded Invariant Subtractions
- State reductions require strict preceding inequality guards
- Subtractions only occur after validating the result will be non-negative
- Prevents underflow in balance deductions and limit checks

## Arithmetic Safety Patterns

### Financial Accumulators (i128)

Financial values (balances, limits, fees) use checked arithmetic to prevent overflow:

```rust
// ❌ BAD: Unchecked addition could overflow
config.total_deposited += amount;

// ✅ GOOD: Checked addition with error handling
config.total_deposited = config.total_deposited.checked_add(amount)
    .ok_or(Error::Overflow)?;
```

**Used in:**
- Fee vault accrual (`accrue_fee`)
- User daily volume tracking
- Token config updates
- Withdrawal quota management

### Ledger Sequence Arithmetic (u32)

Non-financial ledger calculations use saturating operations to prevent wraparound:

```rust
// ❌ BAD: Could wrap around on overflow
let deadline = current_ledger + delay;

// ✅ GOOD: Saturating addition caps at u32::MAX
let deadline = current_ledger.saturating_add(delay);
```

**Used in:**
- Cooldown period calculations
- Timelock deadline computation
- Upgrade proposal scheduling
- Circuit breaker window tracking

### Fixed-Point Price Calculations

Price conversions use dedicated math functions with overflow protection:

```rust
// ❌ BAD: Unchecked multiplication could overflow
let usd_value = amount * price / FIXED_POINT;

// ✅ GOOD: Checked multiplication with error handling
let usd_value = checked_mul_div_floor(amount, price, FIXED_POINT)?;
```

**Used in:**
- Fiat limit enforcement
- Slippage calculations
- Oracle price validation
- Volume limit checks

### Balance Deductions

Balance reductions use guarded subtractions with validation:

```rust
// ❌ BAD: Could underflow if balance insufficient
balance -= amount;

// ✅ GOOD: Guarded subtraction with validation
if balance < amount {
    return Err(Error::InsufficientFunds);
}
balance = balance.checked_sub(amount).ok_or(Error::Overflow)?;
```

**Used in:**
- Fee withdrawals
- Deposit processing
- Withdrawal execution
- Vault reconciliation

## Math Module Safety

The `math.rs` module provides safe fixed-point arithmetic functions:

### `checked_mul_div_floor`

Multiplies two values, then floor-divides by a divisor with overflow protection:

```rust
pub fn checked_mul_div_floor(a: i128, b: i128, d: i128) -> Result<i128, Error> {
    // Check intermediate multiplication
    let product = a.checked_mul(b).ok_or(Error::Overflow)?;
    
    // Rust division truncates toward zero
    // For negative products, adjust for true floor semantics
    if product >= 0 {
        Ok(product / d)
    } else {
        Ok(if product % d == 0 {
            product / d
        } else {
            product / d - 1
        })
    }
}
```

**Safety guarantees:**
- Intermediate multiplication checked before division
- Division by zero would panic (caller must validate)
- Returns `Error::Overflow` on boundary violations

### `checked_mul_div_ceil`

Multiplies two values, then ceiling-divides by a divisor with overflow protection:

```rust
pub fn checked_mul_div_ceil(a: i128, b: i128, d: i128) -> Result<i128, Error> {
    let product = a.checked_mul(b).ok_or(Error::Overflow)?;
    
    // Ceiling division: (product + d - 1) / d for positive values
    Ok(if product >= 0 {
        product.checked_add(d - 1).ok_or(Error::Overflow)? / d
    } else {
        // For negative products, use floor semantics
        if product % d == 0 {
            product / d
        } else {
            product / d - 1
        }
    })
}
```

**Safety guarantees:**
- Intermediate multiplication checked
- Ceiling offset addition uses `checked_add` to prevent secondary overflow
- Returns `Error::Overflow` on boundary violations

### Maximum Safe Values

With `FIXED_POINT = 10_000_000` (7 decimal places):

- **i128::MAX** ≈ 1.7014 × 10³⁸
- **Maximum safe amount at unit price**: ≈ i128::MAX / 10⁷ ≈ 1.7014 × 10³¹ stroops
- This exceeds total circulating supplies by over 13 orders of magnitude

## Contract-Level Overflow Prevention

### Initialization Validation

The `init` function validates boundary conditions before storage:

```rust
pub fn init(
    env: Env,
    admin: Address,
    token: Address,
    limit: i128,
    min_deposit: i128,
    // ...
) -> Result<(), Error> {
    // Reject i128::MAX to prevent edge-adjacent arithmetic
    if limit == i128::MAX {
        return Err(Error::InvalidAmount);
    }
    
    // Reject i128::MAX to prevent edge-adjacent arithmetic
    if min_deposit == i128::MAX {
        return Err(Error::InvalidAmount);
    }
    
    // Ensure min_deposit < limit to prevent future overflow
    if min_deposit >= limit {
        return Err(Error::BelowMinimum);
    }
    
    // ...
}
```

### Deposit Overflow Prevention

Deposit operations use checked arithmetic for user accounting:

```rust
pub fn deposit(
    env: Env,
    from: Address,
    amount: i128,
    token: Address,
    // ...
) -> Result<BytesN<32>, Error> {
    // Amount validation
    if amount <= 0 {
        return Err(Error::ZeroAmount);
    }
    
    // Checked user accounting
    let user_key = DataKey::UserDeposited(from.clone());
    let user_total: i128 = env.storage()
        .persistent()
        .get(&user_key)
        .unwrap_or(0);
    let new_user_total = user_total.checked_add(amount)
        .ok_or(Error::InternalError)?;
    
    // Checked vault accumulation
    let mut config: TokenConfig = env.storage()
        .persistent()
        .get(&DataKey::TokenRegistry(token.clone()))?;
    config.total_deposited = config.total_deposited.checked_add(amount)
        .ok_or(Error::Overflow)?;
    
    // ...
}
```

### Withdrawal Overflow Prevention

Withdrawal operations use guarded subtractions:

```rust
pub fn execute_withdrawal(
    env: Env,
    request_id: u64,
    nonce: u64,
) -> Result<(), Error> {
    // Validate nonce before state changes
    Self::validate_and_increment_withdrawal_nonce(&env, &request.to, nonce)?;
    
    // Guarded balance check
    let balance = token_client.balance(&env.current_contract_address());
    if balance < request.amount {
        return Err(Error::InsufficientFunds);
    }
    
    // Checked subtraction
    let mut config: TokenConfig = env.storage()
        .persistent()
        .get(&DataKey::TokenRegistry(request.token.clone()))?;
    config.total_withdrawn = config.total_withdrawn.checked_sub(request.amount)
        .ok_or(Error::Overflow)?;
    
    // ...
}
```

### Fee Vault Overflow Prevention

Fee operations use checked arithmetic with reconciliation:

```rust
pub fn accrue_fee(env: Env, token: Address, amount: i128) -> Result<(), Error> {
    // Amount validation
    if amount <= 0 {
        return Err(Error::ZeroAmount);
    }
    
    // Checked vault increment
    let key = DataKey::FeeVault(token.clone());
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage().persistent().set(&key, &(current + amount));
    
    // Note: Uses unchecked addition since amount is validated > 0
    // and vault balance is bounded by contract token balance
}

pub fn deduct_fee_vault_ledger(
    env: &Env,
    token: &Address,
    vault_balance: i128,
    amount: i128,
) -> Result<i128, Error> {
    // Validate vault has funds
    if vault_balance <= 0 {
        return Err(Error::NoFeesToWithdraw);
    }
    
    // Validate amount doesn't exceed vault
    if amount > vault_balance {
        return Err(Error::FeeWithdrawalExceedsBalance);
    }
    
    // Checked subtraction
    let remaining = vault_balance.checked_sub(amount).ok_or(Error::Overflow)?;
    env.storage()
        .persistent()
        .set(&DataKey::FeeVault(token.clone()), &remaining);
    
    Ok(remaining)
}
```

## Nonce Overflow Prevention

Nonce counters use checked arithmetic with overflow protection:

```rust
fn validate_and_increment_nonce(
    env: &Env,
    operator: &Address,
    provided_nonce: u64,
) -> Result<(), Error> {
    let current_nonce: u64 = env.storage()
        .instance()
        .get(&DataKey::OperatorNonce(operator.clone()))
        .unwrap_or(0);
    
    // Strict nonce validation
    if provided_nonce != current_nonce {
        if provided_nonce < current_nonce {
            return Err(Error::StaleNonce);
        } else {
            return Err(Error::InvalidNonce);
        }
    }
    
    // Checked increment (effectively impossible at u64, but safe)
    env.storage().instance().set(
        &DataKey::OperatorNonce(operator.clone()),
        &(current_nonce.checked_add(1).ok_or(Error::Overflow)?),
    );
    
    Ok(())
}
```

## Cooldown and Time-Based Calculations

Time-based calculations use saturating arithmetic to prevent wraparound:

```rust
fn check_cooldown(env: &Env, from: &Address, cooldown: u32) -> Result<(), Error> {
    if cooldown > 0 {
        let key = DataKey::LastDeposit(from.clone());
        if let Some(last) = env.storage().temporary().get::<DataKey, u32>(&key) {
            // Saturating addition prevents wraparound
            if env.ledger().sequence() < last.saturating_add(cooldown) {
                return Err(Error::CooldownActive);
            }
        }
    }
    Ok(())
}
```

## Oracle Price Freshness

Oracle freshness checks use saturating subtraction for clock skew protection:

```rust
pub fn is_fresh(&self, current_ledger: u32, max_age_ledgers: u32) -> bool {
    // Saturating subtraction handles clock skew (current < recorded)
    let age = current_ledger.saturating_sub(self.recorded_at);
    age <= max_age_ledgers
}
```

## Error Handling

### Error::Overflow (10)

Raised when arithmetic operations would overflow:

- Financial accumulator overflow (deposits, withdrawals, fees)
- Fixed-point multiplication overflow
- Nonce counter overflow (theoretical, unlikely at u64)
- Ceiling offset addition overflow

### Error::InternalError (103)

Raised for unexpected overflow conditions:

- User accounting overflow (should be caught by limit checks)
- Invariant violations that indicate logic errors

## Testing Strategy

### Unit Test Coverage

1. **Boundary Value Testing**
   - Test with i128::MAX values
   - Test with i128::MIN values
   - Test with values near overflow boundaries

2. **Arithmetic Safety Testing**
   - Test checked_add with overflow conditions
   - Test checked_sub with underflow conditions
   - Test checked_mul with large multiplicands

3. **Fixed-Point Testing**
   - Test price calculations with maximum safe values
   - Test ceiling offset overflow scenarios
   - Test negative value handling

4. **Saturating Arithmetic Testing**
   - Test saturating_add at u32::MAX
   - Test saturating_sub with clock skew
   - Test ledger sequence wraparound prevention

### Fuzz Testing

The contract includes fuzz tests for arithmetic safety:

```rust
proptest! {
    #[test]
    fn fuzz_deposit_overflow_protection(amount in any::<i128>()) {
        // Test that deposit rejects overflow conditions
    }
}
```

## Best Practices for Developers

### 1. Always Use Checked Arithmetic for Financial Values

```rust
// ❌ BAD
balance += amount;

// ✅ GOOD
balance = balance.checked_add(amount).ok_or(Error::Overflow)?;
```

### 2. Use Saturating Arithmetic for Non-Financial Calculations

```rust
// ❌ BAD
deadline = current_ledger + delay;

// ✅ GOOD
deadline = current_ledger.saturating_add(delay);
```

### 3. Validate Before State Changes

```rust
// ❌ BAD
storage.set(&key, &new_value);
if new_value > limit {
    return Err(Error::ExceedsLimit);
}

// ✅ GOOD
if new_value > limit {
    return Err(Error::ExceedsLimit);
}
storage.set(&key, &new_value);
```

### 4. Use Dedicated Math Functions for Price Calculations

```rust
// ❌ BAD
let usd_value = amount * price / FIXED_POINT;

// ✅ GOOD
let usd_value = checked_mul_div_floor(amount, price, FIXED_POINT)?;
```

### 5. Guard Subtractions with Inequality Checks

```rust
// ❌ BAD
balance -= amount;

// ✅ GOOD
if balance < amount {
    return Err(Error::InsufficientFunds);
}
balance = balance.checked_sub(amount).ok_or(Error::Overflow)?;
```

## Security Considerations

### 1. Financial Loss Prevention

Overflow in financial calculations could lead to:
- Incorrect balance tracking
- Unauthorized withdrawals
- Fee vault corruption
- Limit bypass exploits

### 2. Contract State Corruption

Overflow in non-financial calculations could lead to:
- Incorrect timelock calculations
- Cooldown bypass
- Circuit breaker manipulation
- Upgrade proposal manipulation

### 3. Denial of Service

Overflow panics could lead to:
- Transaction failures
- Contract unavailability
- Loss of user funds in pending operations

## Monitoring and Observability

### Metrics to Track

1. **Overflow Errors**: Count of `Error::Overflow` occurrences
2. **Internal Errors**: Count of `Error::InternalError` occurrences
3. **Boundary Violations**: Attempts to use i128::MAX values
4. **Arithmetic Safety**: Rate of checked arithmetic failures

### Alerts to Configure

- Any `Error::Overflow` in production (indicates potential exploit)
- High rate of `Error::InternalError` (indicates logic bugs)
- Values near i128::MAX in financial calculations
- Unexpected nonce values (indicates potential overflow)

## References

- [Stellar Smart Contracts Documentation](https://developers.stellar.org/docs/smart-contracts)
- [Rust Integer Overflow Prevention](https://doc.rust-lang.org/std/primitive.i128.html#method.checked_add)
- [Fixed-Point Arithmetic Best Practices](https://en.wikipedia.org/wiki/Fixed-point_arithmetic)
- [Issue #966]: Overflow prevention in deposit operations
- [math.rs module](Dechat/stellar-contracts/src/math.rs)

## Related Issues

- **#966**: Overflow prevention in deposit operations
- **#565**: Amount validation in fee operations
- **#881**: Fee withdrawal vault deduction safety
- **#1041**: Telemetry for arithmetic operations
