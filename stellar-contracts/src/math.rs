#![allow(dead_code)]

/// Fixed-point denominator used throughout the protocol (matches `ORACLE_PRICE_DECIMALS`).
pub const FIXED_POINT: i128 = 10_000_000;

/// Multiply `a` by `b`, then floor-divide by `d`.
///
/// Uses plain `i128` arithmetic.  Safe for protocol values: price values ≤ `FIXED_POINT`
/// and amounts ≤ typical token supplies keep `a × b` well within `i128` range.
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
/// Uses plain `i128` arithmetic. This is the conservative counterpart to `mul_div_floor`,
/// rounding UP instead of down. Useful for slippage checks where we want to err on the
/// side of safety by rejecting marginal cases.
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
pub fn scale_floor(amount: i128, numerator: i128, denominator: i128) -> i128 {
    mul_div_floor(amount, numerator, denominator)
}
