# Slippage threshold (FiatBridge)

This document explains how the `FiatBridge` contract enforces **maximum slippage in basis points (BPS)** when comparing an **expected** oracle price to the **actual** execution price.

## Where it lives

Implementation: `stellar-contracts/src/lib.rs` — private helper `check_slippage`.

Callers pass:

- `expected_price` — benchmark price (e.g. from the oracle path used for validation).
- `actual_price` — price implied by the current operation.
- `max_slippage_bps` — maximum allowed downward slippage, in basis points (1 BPS = 0.01%, 10_000 BPS = 100%).

## Semantics

1. **Downward slippage only**  
   If `actual_price >= expected_price`, slippage is treated as zero for the threshold check. Upward movement in the user’s favour does not trigger `SlippageTooHigh`.

2. **Displayed slippage (events)**  
   When `actual_price < expected_price`, the contract computes slippage in BPS with **floor division**:

   \[
   \text{slippage\_bps} = \left\lfloor \frac{(\text{expected} - \text{actual}) \times 10\,000}{\text{expected}} \right\rfloor
   \]

   That value is emitted on the `SlippageEvent` for observability.

3. **Assertion vs `max_slippage_bps`**  
   The revert path uses **integer-safe cross-multiplication** so rounding does not spuriously fail or pass:

   - Let `diff = expected - actual` (only when `actual < expected`).
   - Reject if `diff * 10_000 > max_slippage_bps * expected` (strictly over the cap).
   - Otherwise compute `quotient = (diff * 10_000) / expected` (integer division).
   - Reject if `quotient > max_slippage_bps`.
   - If `quotient == max_slippage_bps`, inspect the **remainder** of `(diff * 10_000) % expected`. A remainder that would **ceil** past the cap (remainder ≥ `expected / 2`) also rejects, so boundary behaviour stays aligned with tests that use ceiling-style constructed prices.

Together, these rules give **predictable boundary behaviour** at exactly `max_slippage_bps` versus one BPS over, without floating point.

## Error surface

When the check fails, the contract returns `Error::SlippageTooHigh` (see `ERROR_CODES.md` / `SlippageExceeded` in product docs where applicable).

## Further reading

- Contract tests: `stellar-contracts/src/test.rs` — `test_slippage_*` and boundary suites.
- Overflow / fixed-point context: `stellar-contracts/docs/OVERFLOW_PREVENTION.md`.
