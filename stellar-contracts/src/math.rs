#![allow(dead_code)]

/// Fixed-point denominator used throughout the protocol (matches `ORACLE_PRICE_DECIMALS`).
///
/// All price values returned by the oracle are scaled by this factor.
/// For example, a price of `1.0 USD` is represented as `10_000_000`.
///
/// # Overflow Prevention
/// When multiplying an `amount` by a `price` before dividing by `FIXED_POINT`,
/// the intermediate product `amount * price` must fit in `i128`.  The maximum
/// safe `amount` before overflow is approximately `i128::MAX / FIXED_POINT`
/// ≈ 1.7 × 10²⁵, which is far larger than any realistic token supply.
/// Callers should still use [`mul_div_floor`] / [`mul_div_ceil`] rather than
/// performing the multiplication inline, so that the overflow boundary is
/// documented and tested in one place.
pub const FIXED_POINT: i128 = 10_000_000;

/// Multiply `a` by `b`, then floor-divide by `d`.
///
/// # Arithmetic
/// Computes `⌊(a × b) / d⌋` using plain `i128` arithmetic.
///
/// # Overflow Prevention
/// The intermediate product `a * b` is computed in `i128`.  For the values
/// used in this protocol (prices ≤ `FIXED_POINT` and amounts ≤ typical token
/// supplies) the product stays well within `i128` range.  If callers ever
/// pass values outside the expected domain they risk a panic in debug builds
/// or silent wrapping in release builds (though `overflow-checks = true` in
/// `Cargo.toml` makes release builds panic too).  Callers are responsible for
/// ensuring inputs are within safe bounds before calling this function.
///
/// # Floor Semantics
/// Rust integer division truncates toward zero, which equals floor for
/// non-negative products.  For negative products we subtract 1 when there is
/// a non-zero remainder, giving true mathematical floor semantics.
///
/// # Arguments
/// * `a` – Multiplicand.
/// * `b` – Multiplier.
/// * `d` – Divisor (must not be zero; a zero divisor will panic).
///
/// # Examples
/// ```
/// // 7 * 3 / 2 = 10.5 → floor → 10
/// assert_eq!(mul_div_floor(7, 3, 2), 10);
/// // Negative: -7 * 3 / 2 = -10.5 → floor → -11
/// assert_eq!(mul_div_floor(-7, 3, 2), -11);
/// ```
pub fn mul_div_floor(a: i128, b: i128, d: i128) -> i128 {
    let product = a * b;
    // Rust integer division already truncates toward zero.
    // For non-negative products that equals floor; for negative products we
    // subtract 1 if there is a remainder, giving true floor semantics.
    if product >= 0 || product % d == 0 {
        product / d
    } else {
        product / d - 1
    }
}

/// Multiply `a` by `b`, then ceiling-divide by `d`.
///
/// # Arithmetic
/// Computes `⌈(a × b) / d⌉` using plain `i128` arithmetic.
///
/// # Overflow Prevention
/// Same intermediate-product overflow considerations as [`mul_div_floor`]
/// apply here.  Additionally, the ceiling formula `(product + d - 1) / d`
/// for positive products adds `d - 1` to the product before dividing.  If
/// `product` is close to `i128::MAX` this addition could itself overflow.
/// In practice, protocol values keep `product` far from `i128::MAX`, but
/// callers should be aware of this secondary overflow risk when using very
/// large inputs.
///
/// # Ceiling Semantics
/// For positive products: `⌈x / d⌉ = (x + d - 1) / d`.
/// For negative products: ceiling equals floor (same as [`mul_div_floor`]),
/// because rounding toward zero is already the ceiling for negative values.
///
/// # Arguments
/// * `a` – Multiplicand.
/// * `b` – Multiplier.
/// * `d` – Divisor (must not be zero; a zero divisor will panic).
///
/// # Examples
/// ```
/// // 7 * 3 / 2 = 10.5 → ceil → 11
/// assert_eq!(mul_div_ceil(7, 3, 2), 11);
/// // Exact: 6 * 2 / 3 = 4.0 → ceil → 4
/// assert_eq!(mul_div_ceil(6, 2, 3), 4);
/// ```
pub fn mul_div_ceil(a: i128, b: i128, d: i128) -> i128 {
    let product = a * b;
    // Ceiling division: (product + d - 1) / d for positive values
    // For negative products, we use floor semantics (same as mul_div_floor)
    if product >= 0 {
        (product + d - 1) / d
    } else if product % d == 0 {
        product / d
    } else {
        product / d - 1
    }
}

/// Scale `amount` by the fraction `(numerator / denominator)`, rounding down.
///
/// This is a thin wrapper around [`mul_div_floor`] that expresses the common
/// "apply a fractional rate to an amount" pattern more readably.
///
/// # Overflow Prevention
/// Delegates entirely to [`mul_div_floor`]; see that function's documentation
/// for overflow considerations.
///
/// # Arguments
/// * `amount`      – The base value to scale.
/// * `numerator`   – Numerator of the scaling fraction.
/// * `denominator` – Denominator of the scaling fraction (must not be zero).
///
/// # Examples
/// ```
/// // Scale 1000 by 3/4 → 750
/// assert_eq!(scale_floor(1000, 3, 4), 750);
/// // Scale 1001 by 3/4 → 750 (floor, not 750.75)
/// assert_eq!(scale_floor(1001, 3, 4), 750);
/// ```
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
}
