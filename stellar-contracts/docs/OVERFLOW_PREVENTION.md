# Overflow Prevention Guide

This document describes the overflow-prevention strategy used throughout the
FiatBridge Soroban contract.  It is intended for contributors who are adding
new arithmetic to the contract or reviewing existing code.

---

## Why Overflow Matters in Soroban

Soroban contracts run in a deterministic WASM environment.  The Rust compiler
profile used for release builds (`Cargo.toml`) sets `overflow-checks = true`,
which means integer overflow **panics** rather than wrapping silently.  A
panic aborts the transaction and reverts all state changes — but it also
consumes the caller's fee and can be exploited as a denial-of-service vector
if an attacker can craft inputs that reliably trigger the panic.

For this reason, all arithmetic on values that are influenced by external
inputs (amounts, ledger offsets, counters) must be handled with one of the
strategies below.

---

## Strategies Used in This Contract

### 1. `checked_add` / `checked_sub` → explicit error

Used when overflow would indicate a genuine protocol violation (e.g. a
deposit counter wrapping around would corrupt accounting).

```rust
// ✅ correct — returns Error::Overflow instead of panicking
config.total_deposited = config
    .total_deposited
    .checked_add(amount)
    .ok_or(Error::Overflow)?;
```

**Where used:**
- `deposit` — `total_deposited`, `user_total` accumulation
- `withdraw` — `total_withdrawn` accumulation
- `execute_withdrawal` — `total_withdrawn` accumulation
- `deny_address` — `DeniedCount` increment
- `propose_upgrade` — `executable_after = current_ledger + delay`

### 2. `saturating_add` / `saturating_sub` → clamped result

Used for TTL extensions and window comparisons where clamping to `u32::MAX`
is safe (the value is only used for comparison, not stored as a meaningful
amount).

```rust
// ✅ correct — clamps at u32::MAX rather than wrapping
let receipt_min_ttl = MIN_TTL
    .saturating_add(lock_period)
    .saturating_add(cooldown_ledgers);
```

**Where used:**
- TTL extension calculations in `request_withdrawal`
- Cooldown comparisons: `last.saturating_add(cooldown)`
- Anti-sandwich delay comparisons

### 3. Fixed-point math via `math::mul_div_floor` / `math::mul_div_ceil`

Used for all price × amount calculations to avoid precision loss and
intermediate overflow.  See [`math.rs`](../src/math.rs) for full
documentation.

```rust
// ✅ correct — precision-safe, documented overflow boundary
let usd_cents = crate::math::mul_div_floor(
    amount,
    price,
    ORACLE_PRICE_DECIMALS / 100,
);
```

**Where used:**
- `validate_fiat_limit` — USD-cent conversion
- `check_slippage` — BPS calculation

### 4. Plain arithmetic after a guard

Used when a preceding check makes overflow impossible.

```rust
// ✅ correct — guarded by `total_deposited >= total_withdrawn` check above
let net_deposited = config.total_deposited - config.total_withdrawn;
```

**Where used:**
- `check_invariants` — `net_deposited` subtraction (guarded)
- `execute_withdrawal` — `config.total_liabilities -= execute_amount`
  (guarded by `execute_amount <= request.amount`)

---

## Upgrade Mechanism — Special Considerations

The `propose_upgrade` function computes:

```rust
let executable_after = current_ledger
    .checked_add(delay)
    .ok_or(Error::Overflow)?;
```

This is critical because a silent wrap-around would produce an
`executable_after` value in the **past**, allowing an attacker (or a
misconfigured admin) to bypass the timelock entirely and execute an upgrade
immediately.  The `checked_add` guard ensures this cannot happen — the
transaction reverts with `Error::Overflow` instead.

---

## Window Arithmetic

Rolling 24-hour windows use `u32` ledger sequence numbers.  The window
boundary check is:

```rust
if curr >= record.window_start.saturating_add(WINDOW_LEDGERS) {
    // reset window
}
```

`saturating_add` is used here because:
1. The result is only used in a comparison, never stored as an amount.
2. If `window_start` is near `u32::MAX`, saturating to `u32::MAX` means the
   window never resets — a conservative, safe failure mode.

---

## What NOT to Do

```rust
// ❌ wrong — panics on overflow in release builds (overflow-checks = true)
config.total_deposited += amount;

// ❌ wrong — wraps silently in debug builds, panics in release
let executable_after = current_ledger + delay;

// ❌ wrong — intermediate product may overflow before division
let usd = (amount * price) / ORACLE_PRICE_DECIMALS;
```

---

## Testing Overflow Boundaries

Every overflow-prevention path should have a corresponding test.  See
[`test_new_issues.rs`](../src/test_new_issues.rs) for examples:

```rust
#[test]
fn propose_upgrade_overflow_prevention() {
    // Set ledger near u32::MAX so that adding MIN_UPGRADE_DELAY overflows.
    env.ledger().set_sequence_number(u32::MAX - MIN_UPGRADE_DELAY + 1);
    let result = bridge.try_propose_upgrade(&hash, &MIN_UPGRADE_DELAY);
    assert_eq!(result, Err(Ok(Error::Overflow)));
}
```

---

## Fuzz boundary notes

When adding fuzz/property tests for arithmetic, prefer bounded domains around the contract's
operational ranges rather than unrestricted full-range `i128` generation. See
[`docs/fuzz-test-boundary.md`](../../docs/fuzz-test-boundary.md) for recommended ranges and
"just below / at / just above" edge strategy.

---

## Checklist for New Arithmetic

When adding new arithmetic to the contract, verify:

- [ ] Is the value influenced by external input (amount, ledger offset, counter)?
      → Use `checked_add` / `checked_sub` and return an explicit error.
- [ ] Is the value only used for comparison (TTL, window boundary)?
      → `saturating_add` / `saturating_sub` is acceptable.
- [ ] Does the calculation involve multiplication before division?
      → Use `math::mul_div_floor` or `math::mul_div_ceil`.
- [ ] Is the subtraction guarded by a preceding `>=` check?
      → Plain subtraction is acceptable; add a comment explaining the guard.
- [ ] Is there a test that exercises the overflow boundary?
      → Add one to `test_new_issues.rs` or the relevant test module.
