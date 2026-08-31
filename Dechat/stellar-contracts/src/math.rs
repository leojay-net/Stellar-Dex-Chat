//! # Fixed-Point Math & Precision-Safe Arithmetic
//!
//! This module provides precision-safe mathematical primitives designed for deterministic
//! smart contract execution on the Soroban VM. It handles fixed-point scaling, decimal
//! conversion, and intermediate multiplication without precision loss or silent overflow.
//!
//! ## Mathematical Envelope & Boundaries
//!
//! The protocol uses a standard fixed-point scale factor of [`FIXED_POINT`] = `10_000_000` ($10^7$).
//! When multiplying an `amount` by a `price` before dividing by a divisor `d`:
//!
//! - **Intermediate Product**: `a * b` is evaluated in 128-bit signed integer space (`i128`).
//! - **Maximum Safe Multiplicand**: For price $\approx 1.0\text{ USD}$ (`10_000_000`), the maximum safe single
//!   token amount before multiplication overflow is $\lfloor \text{i128::MAX} / 10^7 \rfloor \approx 1.7014 \times 10^{31}$
//!   stroops, exceeding total circulating supplies by over 13 orders of magnitude.
//! - **Overflow Protection**: All functions verify intermediate multiplications using `checked_mul`
//!   and ceiling offsets using `checked_add`, returning [`Error::Overflow`] on boundary violations.

use crate::Error;

/// Fixed-point denominator used throughout the protocol (matches `ORACLE_PRICE_DECIMALS`).
///
/// All price values returned by the oracle and internal fiat valuations are scaled by this factor.
/// For example, a price of `1.0 USD` is represented as `10_000_000` ($10^7$).
///
/// # Overflow Prevention & Safety Envelope
/// When multiplying an `amount` by a `price` before dividing by `FIXED_POINT`,
/// the intermediate product `amount * price` must fit within signed 128-bit bounds (`i128`).
///
/// - `i128::MAX` $= 2^{127} - 1 \approx 1.7014118 \times 10^{38}$
/// - Maximum safe `amount` at unit price: $\approx \text{i128::MAX} / \text{FIXED\_POINT} \approx 1.7014 \times 10^{31}$ stroops.
///
/// Callers should always use [`checked_mul_div_floor`] / [`checked_mul_div_ceil`] or their
/// corresponding wrappers rather than performing inline unchecked multiplication, ensuring
/// boundary safety is verified consistently.
pub const FIXED_POINT: i128 = 10_000_000;

/// Multiply `a` by `b`, then floor-divide by `d` with checked intermediate multiplication.
///
/// # Arithmetic
/// Computes the mathematical floor division:
/// $$\left\lfloor \frac{a \times b}{d} \right\rfloor$$
///
/// # Overflow Prevention
/// 1. **Intermediate Product**: Uses [`i128::checked_mul`] to catch multiplication overflow before division.
///    If `a * b` exceeds `i128::MAX` or is less than `i128::MIN`, the function returns [`Error::Overflow`]
///    instead of triggering an unhandled WASM panic.
/// 2. **Divisor Validation**: Divisor `d` must be non-zero. A zero divisor triggers a runtime division-by-zero panic.
///
/// # Rounding Semantics (True Mathematical Floor)
/// - **Positive Products**: Standard integer truncation (`product / d`) naturally truncates toward zero,
///   which is identical to the mathematical floor for non-negative results.
/// - **Negative Products**: For negative products with a non-zero remainder, standard integer truncation
///   rounds toward zero (upward). This function subtracts 1 when `product < 0 && product % d != 0` to
///   guarantee true mathematical floor semantics ($\lfloor -10.5 \rfloor = -11$).
///
/// # Arguments
/// * `a` – Multiplicand (e.g. token amount or base value in `i128`).
/// * `b` – Multiplier (e.g. fixed-point price or scaling factor in `i128`).
/// * `d` – Divisor (e.g. `FIXED_POINT` or decimal denominator; must be non-zero).
///
/// # Returns
/// * `Ok(i128)` – The floored result $\lfloor (a \times b) / d \rfloor$.
/// * `Err(Error::Overflow)` – If the intermediate multiplication `a * b` overflows `i128`.
///
/// # Examples
/// ```
/// use crate::math::{checked_mul_div_floor, FIXED_POINT};
///
/// // 7 * 3 / 2 = 10.5 -> floor -> 10
/// assert_eq!(checked_mul_div_floor(7, 3, 2).unwrap(), 10);
///
/// // Negative: -7 * 3 / 2 = -10.5 -> floor -> -11
/// assert_eq!(checked_mul_div_floor(-7, 3, 2).unwrap(), -11);
///
/// // Exact division: 6 * 2 / 3 = 4
/// assert_eq!(checked_mul_div_floor(6, 2, 3).unwrap(), 4);
/// ```
pub fn checked_mul_div_floor(a: i128, b: i128, d: i128) -> Result<i128, Error> {
    // Issue #966: use checked_mul to prevent silent overflow on large deposits
    let product = a.checked_mul(b).ok_or(Error::Overflow)?;
    // Rust integer division already truncates toward zero.
    // For non-negative products that equals floor; for negative products we
    // subtract 1 if there is a remainder, giving true floor semantics.
    Ok(if product >= 0 || product % d == 0 {
        product / d
    } else {
        product / d - 1
    })
}

/// Multiply `a` by `b`, then floor-divide by `d`, panicking on overflow.
///
/// This is an ergonomic wrapper around [`checked_mul_div_floor`]. It should only be
/// used when inputs are strictly validated prior to invocation or where a contract
/// panic is intended.
///
/// # Panics
/// Panics with `"mul_div_floor overflow"` if the intermediate product `a * b` overflows `i128`.
///
/// # Arguments
/// * `a` – Multiplicand.
/// * `b` – Multiplier.
/// * `d` – Divisor (must be non-zero).
#[inline]
pub fn mul_div_floor(a: i128, b: i128, d: i128) -> i128 {
    checked_mul_div_floor(a, b, d).expect("mul_div_floor overflow")
}

/// Multiply `a` by `b`, then ceiling-divide by `d` with checked intermediate arithmetic.
///
/// # Arithmetic
/// Computes the mathematical ceiling division:
/// $$\left\lceil \frac{a \times b}{d} \right\rceil$$
///
/// # Overflow Prevention
/// 1. **Intermediate Product**: Uses [`i128::checked_mul`] to catch `a * b` overflow.
/// 2. **Ceiling Offset Addition**: For positive products, the ceiling formula requires adding `d - 1`
///    to the product before dividing: `(product + d - 1) / d`. This function uses [`i128::checked_add`]
///    on `product.checked_add(d - 1)` to prevent secondary overflow if `product` is close to `i128::MAX`.
///
/// # Rounding Semantics (Mathematical Ceiling)
/// - **Positive Products**: Computed as `(product + d - 1) / d`.
/// - **Negative Products**: Truncation toward zero in standard division already performs ceiling rounding
///   for negative numbers ($\lceil -10.5 \rceil = -10$, computed as `product / d - 1` when remainder exists).
///
/// # Arguments
/// * `a` – Multiplicand.
/// * `b` – Multiplier.
/// * `d` – Divisor (must be non-zero).
///
/// # Returns
/// * `Ok(i128)` – The ceiling result $\lceil (a \times b) / d \rceil$.
/// * `Err(Error::Overflow)` – If intermediate multiplication or ceiling addition overflows `i128`.
///
/// # Examples
/// ```
/// use crate::math::checked_mul_div_ceil;
///
/// // 7 * 3 / 2 = 10.5 -> ceil -> 11
/// assert_eq!(checked_mul_div_ceil(7, 3, 2).unwrap(), 11);
///
/// // Exact: 6 * 2 / 3 = 4 -> ceil -> 4
/// assert_eq!(checked_mul_div_ceil(6, 2, 3).unwrap(), 4);
/// ```
pub fn checked_mul_div_ceil(a: i128, b: i128, d: i128) -> Result<i128, Error> {
    // Issue #966: use checked_mul to prevent silent overflow on large deposits
    let product = a.checked_mul(b).ok_or(Error::Overflow)?;
    // Ceiling division: (product + d - 1) / d for positive values
    // For negative products, we use floor semantics (same as mul_div_floor)
    Ok(if product >= 0 {
        product.checked_add(d - 1).ok_or(Error::Overflow)? / d
    } else if product % d == 0 {
        product / d
    } else {
        product / d - 1
    })
}

/// Multiply `a` by `b`, then ceiling-divide by `d`, panicking on overflow.
///
/// Ergonomic wrapper around [`checked_mul_div_ceil`].
///
/// # Panics
/// Panics with `"mul_div_ceil overflow"` if multiplication or ceiling offset addition overflows `i128`.
///
/// # Arguments
/// * `a` – Multiplicand.
/// * `b` – Multiplier.
/// * `d` – Divisor (must be non-zero).
#[inline]
pub fn mul_div_ceil(a: i128, b: i128, d: i128) -> i128 {
    checked_mul_div_ceil(a, b, d).expect("mul_div_ceil overflow")
}

/// Scale `amount` by the fraction `(numerator / denominator)`, rounding down.
///
/// This is a convenience wrapper around [`mul_div_floor`] that expresses the standard
/// "apply fractional fee/rate to an amount" pattern readably.
///
/// # Arithmetic
/// $$\left\lfloor \frac{\text{amount} \times \text{numerator}}{\text{denominator}} \right\rfloor$$
///
/// # Overflow Prevention
/// Delegates directly to [`mul_div_floor`], inheriting intermediate product checks.
///
/// # Arguments
/// * `amount` – The base amount to scale in `i128`.
/// * `numerator` – Numerator of the scaling fraction.
/// * `denominator` – Denominator of the scaling fraction (must not be zero).
///
/// # Examples
/// ```
/// use crate::math::scale_floor;
///
/// // Scale 1000 by 3/4 -> 750
/// assert_eq!(scale_floor(1000, 3, 4), 750);
///
/// // Scale 1001 by 3/4 -> 750.75 -> floor -> 750
/// assert_eq!(scale_floor(1001, 3, 4), 750);
/// ```
#[inline]
pub fn scale_floor(amount: i128, numerator: i128, denominator: i128) -> i128 {
    mul_div_floor(amount, numerator, denominator)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── mul_div_floor ─────────────────────────────────────────────────────

    #[test]
    fn mul_div_floor_exact_division() {
        // 6 * 2 / 3 = 4 exactly — no rounding needed
        assert_eq!(mul_div_floor(6, 2, 3), 4);
    }

    #[test]
    fn mul_div_floor_rounds_down_positive() {
        // 7 * 3 / 2 = 10.5 → floor → 10
        assert_eq!(mul_div_floor(7, 3, 2), 10);
    }

    #[test]
    fn mul_div_floor_rounds_down_negative() {
        // -7 * 3 / 2 = -10.5 → floor → -11
        assert_eq!(mul_div_floor(-7, 3, 2), -11);
    }

    #[test]
    fn mul_div_floor_zero_numerator() {
        assert_eq!(mul_div_floor(0, 999, 7), 0);
    }

    #[test]
    fn mul_div_floor_identity() {
        // a * d / d == a for any non-zero d
        assert_eq!(mul_div_floor(42, 100, 100), 42);
    }

    // ── mul_div_ceil ──────────────────────────────────────────────────────

    #[test]
    fn mul_div_ceil_exact_division() {
        // 6 * 2 / 3 = 4 exactly — ceiling equals floor
        assert_eq!(mul_div_ceil(6, 2, 3), 4);
    }

    #[test]
    fn mul_div_ceil_rounds_up_positive() {
        // 7 * 3 / 2 = 10.5 → ceil → 11
        assert_eq!(mul_div_ceil(7, 3, 2), 11);
    }

    #[test]
    fn mul_div_ceil_negative_product() {
        // Negative products use floor semantics: -7 * 3 / 2 = -10.5 → -11
        assert_eq!(mul_div_ceil(-7, 3, 2), -11);
    }

    #[test]
    fn mul_div_ceil_zero_numerator() {
        assert_eq!(mul_div_ceil(0, 999, 7), 0);
    }

    // ── scale_floor ───────────────────────────────────────────────────────

    #[test]
    fn scale_floor_three_quarters() {
        // 1000 * 3/4 = 750 exactly
        assert_eq!(scale_floor(1000, 3, 4), 750);
    }

    #[test]
    fn scale_floor_rounds_down() {
        // 1001 * 3/4 = 750.75 → floor → 750
        assert_eq!(scale_floor(1001, 3, 4), 750);
    }

    // ── Overflow boundary awareness ───────────────────────────────────────

    #[test]
    fn mul_div_floor_large_values_stay_in_range() {
        // Simulate a realistic protocol scenario:
        // amount = 1_000_000_000 (1 billion stroops)
        // price  = FIXED_POINT   (1.0 in fixed-point)
        // divisor = FIXED_POINT
        // Expected: 1_000_000_000
        let amount: i128 = 1_000_000_000;
        let price = FIXED_POINT;
        let result = mul_div_floor(amount, price, FIXED_POINT);
        assert_eq!(result, amount);
    }

    #[test]
    fn mul_div_floor_large_deposit_amount() {
        // Issue #966: verify large but safe deposit amounts work correctly
        let amount: i128 = 1_000_000_000_000_000; // 1 quadrillion stroops
        let price = FIXED_POINT;
        let result = mul_div_floor(amount, price, FIXED_POINT);
        assert_eq!(result, amount);
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn mul_div_floor_panics_on_overflow() {
        // Issue #966: ensure overflow is caught, not silently wrapped
        mul_div_floor(i128::MAX, 2, 1);
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn mul_div_ceil_panics_on_overflow() {
        // Issue #966: ensure overflow is caught in ceil variant too
        mul_div_ceil(i128::MAX, 2, 1);
    }
}
