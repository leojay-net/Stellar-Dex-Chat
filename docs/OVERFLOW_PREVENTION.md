# Overflow Prevention & Arithmetic Safety Architecture

This guide serves as the overarching architectural reference for numerical safety, integer overflow prevention, fixed-point math, and boundary enforcement across the **Stellar-Dex-Chat** ecosystem, spanning both the Soroban smart contracts (`stellar-contracts`) and client frontend SDKs (`dex_with_fiat_frontend`).

---

## 1. Architectural Overview

Across decentralized finance (DeFi) protocols and high-throughput real-time messaging, arithmetic safety must be guaranteed across all execution layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   END-TO-END ARITHMETIC SAFETY LAYERS                  │
├────────────────────────────────────────────────────────────────────────┤
│ 1. CLIENT / SDK LAYER (TypeScript)                                     │
│    • Exact BigInt arithmetic for Stroop / XLM conversions              │
│    • Zero floating-point rounding or IEEE-754 precision loss           │
│    • Strict string-based regex validation (max 7 decimal places)       │
├────────────────────────────────────────────────────────────────────────┤
│ 2. INPUT SANITIZATION & BOUNDARY GUARDS (Soroban Contracts)            │
│    • Range assertion: amount > 0, amount != i128::MAX                  │
│    • Vector caps: signers <= MAX_SIGNERS (20), ref len <= 64           │
│    • Nonce & query bounds (idx < ReceiptCounter)                       │
├────────────────────────────────────────────────────────────────────────┤
│ 3. DETERMINISTIC SMART CONTRACT MATH (Rust / Soroban VM)               │
│    • Checked arithmetic (checked_add, checked_sub, checked_mul)        │
│    • Precision-safe fixed-point routines (checked_mul_div_floor / ceil)│
│    • Saturating sequence arithmetic for TTLs & 24h rolling windows     │
│    • Integer cross-multiplication for basis points & slippage caps     │
├────────────────────────────────────────────────────────────────────────┤
│ 4. PERSISTENT INVARIANT ENFORCEMENT                                    │
│    • Guarded state transitions: total_deposited >= total_withdrawn    │
│    • Timelock overflow traps preventing past-ledger execution bypass   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Smart Contract Overflow Architecture (`stellar-contracts`)

Soroban smart contracts execute inside a deterministic WebAssembly runtime. With `overflow-checks = true` enabled in release profiles, unhandled arithmetic overflows cause an execution panic (WASM trap).

To ensure structured, actionable error propagation and prevent gas-drain / denial-of-service vectors, the protocol uses five core strategies:

### 2.1 Checked Operations
All protocol accounting accumulators use `checked_add` / `checked_sub` and return typed errors (`Error::Overflow` / `Error::InternalError`):
- `config.total_deposited.checked_add(amount).ok_or(Error::Overflow)?`
- `user_total.checked_add(amount).ok_or(Error::InternalError)?`
- `config.total_liabilities.checked_add(amount).ok_or(Error::Overflow)?`

### 2.2 Saturating Operations for Non-Financial Quantities
Ledger sequences, rolling window boundaries, and storage TTL extensions use `saturating_add`:
- `last.saturating_add(cooldown)`
- `record.window_start.saturating_add(WINDOW_LEDGERS)`
- `MIN_TTL.saturating_add(lock_period).saturating_add(cooldown_ledgers)`

### 2.3 Fixed-Point Math (`math.rs`)
Fixed-point calculations use a scale factor of $\text{FIXED\_POINT} = 10\,000\,000$ ($10^7$):
- $\lfloor (a \times b) / d \rfloor \rightarrow$ `crate::math::checked_mul_div_floor(a, b, d)`
- $\lceil (a \times b) / d \rceil \rightarrow$ `crate::math::checked_mul_div_ceil(a, b, d)`
- $\text{Amount} \times (N / D) \rightarrow$ `crate::math::scale_floor(amount, num, den)`

**Safe Multiplication Envelope**:
$$\text{Intermediate Product } a \times b < i128::MAX \approx 1.7014 \times 10^{38}$$
$$\text{Maximum safe single-token input: } \approx \frac{i128::MAX}{10^7} \approx 1.7014 \times 10^{31} \text{ stroops}$$

### 2.4 Cross-Multiplication for Slippage & Basis Points
To eliminate integer division truncation in percentage checks:
$$\text{diff} \times 10\,000 > \text{max\_slippage\_bps} \times \text{expected\_price} \implies \text{Reject with } \text{Error::SlippageTooHigh}$$
See [`docs/slippage-threshold.md`](slippage-threshold.md) for full mathematical analysis.

### 2.5 Timelock Protection
Upgrade and administrative timelocks enforce `current_ledger.checked_add(delay).ok_or(Error::Overflow)?`, ensuring that sequence number wraparound cannot create an `executable_after` ledger in the past.

---

## 3. Frontend & Client-Side Arithmetic Safety (`dex_with_fiat_frontend`)

### 3.1 Avoiding Floating-Point Drift
JavaScript's standard `Number` type (IEEE-754 64-bit float) loses precision beyond `Number.MAX_SAFE_INTEGER` ($2^{53}-1 \approx 9.007 \times 10^{15}$). In Stellar, $1\text{ XLM} = 10\,000\,000\text{ stroops}$ ($10^7$).

All conversions in [`src/lib/stroops.ts`](../Dechat/dex_with_fiat_frontend/src/lib/stroops.ts) are strictly implemented using string parsing and native JavaScript `BigInt`:

```typescript
// xlmToStroops: Exact conversion without floating-point math
export function xlmToStroops(xlm: string | number): bigint | null {
  const normalized = String(xlm).trim();
  if (!normalized || !/^\d*(?:\.\d{0,7})?$/.test(normalized)) {
    return null;
  }
  const [wholePart = '0', fractionalPart = ''] = normalized.split('.');
  const whole = wholePart || '0';
  const fraction = (fractionalPart || '').padEnd(7, '0');
  return BigInt(whole) * 10_000_000n + BigInt(fraction || '0');
}
```

### 3.2 stroopsToXlm Formatting
Formatting stroop amounts back to human-readable strings uses integer division and remainder extraction:
$$\text{whole} = \lfloor \text{stroops} / 10^7 \rfloor, \quad \text{frac} = \text{stroops} \pmod{10^7}$$
Trailing zeros in the fractional part are cleanly trimmed, and no intermediate float values are produced.

---

## 4. Testing & Verification

Boundary testing is mandatory for all arithmetic changes:
- **Smart Contracts**: Unit and invariant tests in `stellar-contracts/src/test*.rs`. Boundary test cases verify `0`, `1`, `FIXED_POINT`, `i128::MAX / FIXED_POINT`, `u32::MAX - delay`, and `u64::MAX`.
- **Fuzz Testing**: Property-based tests verify bounded domain spaces (see [`docs/fuzz-test-boundary.md`](fuzz-test-boundary.md)).
- **Frontend**: Unit tests in `dex_with_fiat_frontend/src/lib/*.test.ts` verifying arbitrary-precision conversion and string boundary values.

---

## 5. Related Documentation

- [Smart Contract Detailed Overflow Guide](../Dechat/stellar-contracts/docs/OVERFLOW_PREVENTION.md)
- [Slippage Threshold Specification](slippage-threshold.md)
- [Fuzz Test Boundary Guide](fuzz-test-boundary.md)
- [TypeScript SDK Examples](typescript-sdk-examples.md)
