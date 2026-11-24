# Soroban Smart Contract Overflow Prevention Architecture

This document describes the end-to-end overflow prevention architecture, arithmetic safety invariants, and defensive coding standards implemented across the FiatBridge Soroban smart contracts. It is intended for protocol engineers, security auditors, and open-source contributors who are adding new arithmetic operations or reviewing contract state transitions.

---

## 1. Executive Summary & Philosophy

Financial smart contracts must ensure that no arithmetic calculation can silently wrap around, truncate unexpectedly, or crash the execution environment unpredictably. In the **Stellar / Soroban WASM ecosystem**, integer overflow handling is a critical pillar of protocol security and operational reliability.

Our philosophy enforces **multi-tier defense-in-depth**:
1. **Never allow implicit wrapping** on numerical calculations.
2. **Prefer explicit error returns (`Error::Overflow`, `Error::InternalError`) over unhandled panics** on all user-influenced input paths, preventing transaction-abort denial-of-service (DoS) and gas exhaustion vulnerabilities.
3. **Use domain-appropriate arithmetic primitives** (Checked, Saturating, Fixed-Point, or Guarded) tailored specifically to the semantics of each state variable (monetary amounts vs. ledger sequence offsets vs. monotonic counters).
4. **Enforce strict input envelopes** before any arithmetic computation occurs.

---

## 2. Soroban Deterministic Execution & The Arithmetic Failure Model

### 2.1 The Soroban VM & WASM Runtime
Soroban contracts compile to WebAssembly (WASM) and execute within the deterministic Soroban Virtual Machine. In standard Rust compilation profiles:
- In `debug` mode, integer overflows trigger a runtime panic.
- In default release mode, integer operations silently wrap using two's complement arithmetic.

In our contract configuration (`Cargo.toml`), release builds explicitly configure:
```toml
[profile.release]
overflow-checks = true
```
This guarantees that **any unguarded integer overflow will panic in both debug and release builds**.

### 2.2 Why Panics are DoS & Gas-Drain Risks
While a panic guarantees state reversibility (the transaction fails and no state is corrupted), relying on compiler-level panic traps creates severe operational issues:
- **Opaque Errors**: Callers and SDKs receive an unformatted WASM trap rather than a structured Soroban `Error` enum (e.g. `Error::Overflow` / error code `10`).
- **Gas & Fee Consumption**: The caller pays full transaction base fees and resource fees, but receives no actionable diagnostic information.
- **Protocol Griefing / DoS**: Malicious actors or ill-conditioned external integrations could craft transactions that trigger gas-exhausting panics, locking downstream pipeline processing.

Therefore, **all public entry points and user-influenced calculations must intercept boundaries via structured error returns**.

---

## 3. The Five Arithmetic Strategies

Every arithmetic operation in the codebase adheres to one of five established strategies:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ARITHMETIC STRATEGY TAXONOMY                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. CHECKED ARITHMETIC       │  checked_add / checked_sub / checked_mul      │
│                             │  → Returns Result<T, Error::Overflow>         │
│                             │  → Used for: Deposits, Withdrawals, Nonces    │
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 2. SATURATING ARITHMETIC    │  saturating_add / saturating_sub              │
│                             │  → Clamps result at u32::MAX / 0              │
│                             │  → Used for: TTL extensions, Rolling Windows  │
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 3. FIXED-POINT PRECISION    │  checked_mul_div_floor / ceil / scale_floor   │
│                             │  → Checked intermediate product before div    │
│                             │  → Used for: Price Oracles, USD Conversion    │
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 4. GUARDED ARITHMETIC       │  Plain subtraction preceded by >= assertion   │
│                             │  → Mathematically proven unreachable underflow│
│                             │  → Used for: Liability decrements             │
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 5. CROSS-MULTIPLICATION     │  (diff * 10_000) vs (threshold * expected)    │
│                             │  → Eliminates integer division truncation     │
│                             │  → Used for: Slippage BPS boundary checks     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Strategy 1: Checked Arithmetic (`checked_add` / `checked_sub` / `checked_mul`)

Used whenever an arithmetic result represents a protocol accounting quantity, unique ID, or financial balance where overflow or underflow would corrupt state.

```rust
// ✅ Correct: Returns explicit Error::Overflow without panicking
config.total_deposited = config
    .total_deposited
    .checked_add(amount)
    .ok_or(Error::Overflow)?;

let new_user_total = user_total
    .checked_add(amount)
    .ok_or(Error::InternalError)?;
```

**Where applied:**
- `deposit` — `config.total_deposited`, `user_total` accumulation.
- `withdraw` — `config.total_withdrawn` accumulation.
- `request_withdrawal` — `config.total_liabilities` accumulation.
- `execute_withdrawal` — `config.total_withdrawn` accumulation.
- `propose_upgrade` / `queue_admin_action` — Timelock calculation: `current_ledger.checked_add(delay)`.
- `deny_address` / `allowlist` — `DeniedCount` / `AllowlistCount` monotonic increments.
- `set_operator` / `heartbeat` / `init` — Nonce validation and sequential increments.

---

### Strategy 2: Saturating Arithmetic (`saturating_add` / `saturating_sub`)

Used for non-financial variables (such as ledger sequence offsets, TTL expirations, and window comparisons) where clamping at upper (`u32::MAX`) or lower (`0`) limits produces a deterministic, failsafe operational state.

```rust
// ✅ Correct: Clamps at u32::MAX rather than overflowing or wrapping
let receipt_min_ttl = MIN_TTL
    .saturating_add(lock_period)
    .saturating_add(cooldown_ledgers);

// ✅ Correct: Rolling 24-hour ledger window comparison
if current_ledger >= record.window_start.saturating_add(WINDOW_LEDGERS) {
    record.usd_cents = 0;
    record.window_start = current_ledger;
}
```

**Safety Rationale for Saturating Bounds:**
1. **Window Safety**: If `record.window_start` is near `u32::MAX`, `saturating_add` clamps to `u32::MAX`, preventing the rolling window from resetting prematurely (a fail-secure posture).
2. **TTL Extensions**: Clamping TTL calculations to `u32::MAX` ensures storage entries remain alive for the maximum possible ledger lifetime without risking runtime reverts.

---

### Strategy 3: Safe Fixed-Point Math (`crate::math`)

Used for all price oracle computations, decimal scaling, and fractional fee distributions.

Standard fixed-point scale factor:
$$\text{FIXED\_POINT} = 10\,000\,000 \quad (10^7, \text{ matching } \text{ORACLE\_PRICE\_DECIMALS})$$

```rust
// ✅ Correct: Precision-safe fixed-point floor division
let usd_cents = crate::math::checked_mul_div_floor(
    amount,
    price,
    ORACLE_PRICE_DECIMALS / 100,
)?;
```

See [Section 4](#4-fixed-point-math--intermediate-product-envelope) for intermediate product boundary proofs.

---

### Strategy 4: Guarded Plain Arithmetic (Proven Invariants)

Used only when a preceding condition mathematically guarantees that underflow or overflow is impossible. A developer comment must accompany each guarded operation.

```rust
// Invariant: Checked by request lookup and caller assertion (execute_amount <= request.amount)
// And config.total_liabilities >= request.amount is enforced on request creation.
config.total_liabilities -= execute_amount;
```

**Where applied:**
- `execute_withdrawal`: `config.total_liabilities -= execute_amount` (guarded by `execute_amount <= request.amount`).
- `check_invariants`: `net_deposited = config.total_deposited - config.total_withdrawn` (guarded by `total_deposited >= total_withdrawn`).

---

### Strategy 5: Cross-Multiplication for Slippage & Basis Points

When computing basis points ($\text{BPS} = 1/10\,000 = 0.01\%$), integer division truncates remainder digits ($\lfloor x / y \rfloor$). If standard division were used:
$$\frac{(\text{expected} - \text{actual}) \times 10\,000}{\text{expected}} \le \text{max\_slippage\_bps}$$
a price difference slightly above the slippage cap could round down and spuriously bypass the guard.

To guarantee zero precision loss, the contract implements cross-multiplication:
```rust
let diff = expected_price - actual_price; // Guarded by actual_price < expected_price
let max_i128 = max_slippage_bps as i128;
let threshold = max_i128 * expected_price;

// Fast reject without division truncation
if diff * 10_000 > threshold {
    return Err(Error::SlippageTooHigh);
}
```
In addition, for exact quotient boundary values, the remainder is tested to catch ceiling-rounding edges:
```rust
let numerator = diff * 10_000;
let quotient = numerator / expected_price;
if quotient == max_i128 {
    let remainder = numerator % expected_price;
    if remainder > 0 && remainder >= expected_price / 2 {
        return Err(Error::SlippageTooHigh);
    }
}
```

---

## 4. Fixed-Point Math & Intermediate Product Envelope

### 4.1 Mathematical Envelope
When multiplying `amount` ($\text{i128}$) by `price` ($\text{i128}$) before dividing by `FIXED_POINT` ($10^7$):
$$\text{Intermediate Product } P = a \times b$$

The range of signed 128-bit integer is:
$$\text{i128::MAX} = 2^{127} - 1 \approx 1.7014118 \times 10^{38}$$

For an oracle price scaled to $1.0\text{ USD} = 10\,000\,000$, the maximum safe single-token input amount before intermediate multiplication overflow is:
$$\text{Amount}_{\text{max}} = \left\lfloor \frac{\text{i128::MAX}}{\text{FIXED\_POINT}} \right\rfloor \approx \frac{1.7014 \times 10^{38}}{10^7} \approx 1.7014 \times 10^{31} \text{ stroops}$$

Given that the entire total supply of XLM is $50 \times 10^9 \text{ XLM} = 5 \times 10^{17} \text{ stroops}$, the maximum safe threshold ($1.7 \times 10^{31}$) is **13 orders of magnitude larger than the global maximum token supply**.

### 4.2 Ceiling Division Overflow Protection
In `checked_mul_div_ceil(a, b, d)`, the ceiling formula for positive numbers computes:
$$\left\lceil \frac{a \times b}{d} \right\rceil = \left\lfloor \frac{(a \times b) + (d - 1)}{d} \right\rfloor$$

To ensure that adding $(d - 1)$ cannot overflow `i128::MAX`, `checked_mul_div_ceil` uses two distinct checked stages:
```rust
// Stage 1: Check intermediate multiplication
let product = a.checked_mul(b).ok_or(Error::Overflow)?;

// Stage 2: Check ceiling adjustment addition
if product >= 0 {
    product.checked_add(d - 1).ok_or(Error::Overflow)? / d
} else {
    // True floor/ceil semantics for negative numbers
    if product % d == 0 { product / d } else { product / d - 1 }
}
```

---

## 5. Subsystem-Specific Overflow Safeguards

### 5.1 Timelock Sequence Overflow Prevention
In governance and upgrades, timelock periods are enforced via ledger sequence numbers (`u32`):
```rust
let target_ledger = current_ledger
    .checked_add(delay)
    .ok_or(Error::Overflow)?;
```
**Vulnerability Prevented**: If `current_ledger + delay` were to wrap around silently, `target_ledger` would become a small integer in the past ($< \text{current\_ledger}$), allowing an attacker or misconfigured script to execute timelocked upgrades immediately. The `checked_add` guard eliminates this attack vector.

### 5.2 Storage Key Bounds & Monotonic Counters
Monotonic sequence counters (`ReceiptCounter`, `NextMultisigID`) increment using `u64`:
- At 1,000 operations per second, exhausting a `u64` range ($2^{64}-1 \approx 1.84 \times 10^{19}$) would require over **584 million years**.
- Regardless, counter increments are guarded by `checked_add(1).ok_or(Error::Overflow)` to maintain rigorous mathematical guarantees.
- Read queries (`get_receipt_by_index`) enforce explicit bounds checking (`idx >= ReceiptCounter` returns `None` / `Error::ReceiptIndexOutOfBounds`) prior to storage interaction, neutralizing key-probing attacks.

### 5.3 Daily Limit & Volume Accumulators
Rolling 24-hour limit windows reset when `current_ledger >= window_start.saturating_add(WINDOW_LEDGERS)`. Volume additions within the active window are checked against the configured limit before committing state:
```rust
if vol.usd_cents + usd_cents > limit {
    return Err(Error::ExceedsFiatLimit);
}
vol.usd_cents += usd_cents;
```

---

## 6. Contract Arithmetic Operations Reference Matrix

| Function | Operation / Arithmetic Domain | Primary Risk Vector | Mitigation Strategy | Failure Error Code |
| :--- | :--- | :--- | :--- | :--- |
| `init` | Admin limit & threshold verification | `i128::MAX` boundary value | Strict inequality (`limit != i128::MAX`) | `Error::InvalidAmount` |
| `deposit` | Vault `total_deposited` accumulation | Accumulator overflow | `checked_add` | `Error::Overflow` |
| `deposit` | User balance `user_total` accumulation | Accumulator overflow | `checked_add` | `Error::InternalError` |
| `deposit` | Cooldown verification | Sequence number overflow | `last.saturating_add(cooldown)` | `Error::CooldownActive` |
| `deposit` | Monotonic `ReceiptCounter` increment | Index overflow | `receipt_counter.checked_add(1)` | `Error::Overflow` |
| `withdraw` | Vault `total_withdrawn` accumulation | Balance overflow | `checked_add` | `Error::InternalError` |
| `request_withdrawal` | `total_liabilities` accumulation | Liability overflow | `checked_add` | `Error::Overflow` |
| `request_withdrawal` | TTL calculation | Storage TTL overflow | `saturating_add` (MIN_TTL + lock + cooldown) | Clamped at `u32::MAX` |
| `execute_withdrawal` | `total_liabilities` reduction | Underflow | Guarded subtraction (`<= request.amount`) | Invariant assertion |
| `execute_withdrawal` | `total_withdrawn` accumulation | Accumulator overflow | `checked_add` | `Error::InternalError` |
| `validate_fiat_limit` | Oracle price $\times$ amount conversion | Intermediate product overflow | `math::checked_mul_div_floor` | `Error::Overflow` |
| `validate_fiat_limit` | 24-hour window rollover | Ledger overflow | `window_start.saturating_add(WINDOW_LEDGERS)` | Safe saturation |
| `check_slippage` | Slippage BPS verification | Division truncation evasion | Cross-multiplication with remainder check | `Error::SlippageTooHigh` |
| `propose_upgrade` | Upgrade timelock sequence | Wraparound past-ledger bypass | `current_ledger.checked_add(delay)` | `Error::Overflow` |
| `queue_admin_action` | Action timelock sequence | Wraparound past-ledger bypass | `current_ledger.checked_add(delay)` | `Error::Overflow` |
| `deny_address` | `DeniedCount` increment | Counter overflow | `count.checked_add(1)` | `Error::Overflow` |
| `prune_inactive_operators` | Operator iteration index | Loop counter overflow | `idx.checked_add(1)` | Handled via loop break |
| `withdraw_fees` | Fee vault balance reduction | Vault underflow | `checked_sub` | `Error::FeeWithdrawalExceedsBalance` |

---

## 7. Common Anti-Patterns ("What NOT to Do")

```rust
// ❌ WRONG: Panics on overflow in release builds (overflow-checks = true)
config.total_deposited += amount;

// ❌ WRONG: Silent wraparound in standard release, panic in overflow-checked profile
let target_ledger = current_ledger + delay;

// ❌ WRONG: Intermediate product overflows before division
let usd = (amount * price) / ORACLE_PRICE_DECIMALS;

// ❌ WRONG: Integer division truncates remainder, enabling fractional slippage evasion
let slippage_bps = ((expected - actual) * 10_000) / expected;
if slippage_bps > max_slippage { return Err(Error::SlippageTooHigh); }

// ❌ WRONG: Direct subtraction without preceding invariant guard
config.total_liabilities -= withdrawal_amount;
```

---

## 8. Frontend & Cross-Layer Arithmetic Safety

Arithmetic safety extends beyond the contract boundaries to client applications, SDKs, and indexers.

### 8.1 Zero Floating-Point Rule
JavaScript `Number` types use IEEE-754 64-bit binary floating point arithmetic, which suffers from:
- Fractional precision loss (e.g. `0.1 + 0.2 !== 0.3`).
- Unsafe integer ranges above `Number.MAX_SAFE_INTEGER` ($2^{53}-1 = 9\,007\,199\,254\,740\,991$).

All frontend conversions between XLM and stroops ($1\text{ XLM} = 10^7\text{ stroops}$) **must use string parsing and native `BigInt` arithmetic** (see [`stroops.ts`](../../dex_with_fiat_frontend/src/lib/stroops.ts)):
```typescript
// ✅ Safe: Exact BigInt conversion with zero float loss
export function xlmToStroops(xlm: string | number): bigint | null {
  // Regex validation: max 7 fractional digits
  if (!/^\d*(?:\.\d{0,7})?$/.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
}
```

---

## 9. Contributor Checklist for New Arithmetic

When adding or modifying arithmetic in any contract or frontend component, verify:

- [ ] **Input Envelope**: Is every numerical argument validated for non-zero, non-negative, and $\ne \text{i128::MAX}$ bounds?
- [ ] **Checked Operations**: Are all accumulator additions and subtractions performed using `checked_add` / `checked_sub` returning explicit `Error::Overflow`?
- [ ] **Fixed-Point Helper**: Are price and percentage multiplications routed through `math::checked_mul_div_floor` or `math::checked_mul_div_ceil`?
- [ ] **Sequence Offsets**: Are TTL and window sequence numbers using `saturating_add`?
- [ ] **Timelocks**: Are execution delays calculated with `checked_add` to prevent timelock-bypass attacks?
- [ ] **Guarded Invariants**: Are all plain subtractions preceded by an explicit `>=` check and documented with an invariant comment?
- [ ] **Testing**: Does the test suite include boundary test cases covering `0`, `1`, `FIXED_POINT`, `i128::MAX / FIXED_POINT`, `u32::MAX - delay`, and `u64::MAX`?
- [ ] **Frontend Precision**: Are client-side conversions strictly utilizing `BigInt` without floating-point math?
