//! Tests for issue #1019 – oracle.rs price feed validation with stale timestamps.
//!
//! Acceptance criteria:
//!   1. A price just *within* the freshness window is accepted.
//!   2. A price just *outside* the freshness window is rejected.
//!   3. The exact threshold boundary is handled correctly (fence-post).

#![cfg(test)]
extern crate std;

use crate::oracle::TimestampedPrice;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Build a `TimestampedPrice` recorded at `recorded_at` and check it against
/// `current_ledger` with the given `max_age_ledgers`.
fn check(recorded_at: u32, current_ledger: u32, max_age_ledgers: u32) -> bool {
    TimestampedPrice {
        price: 10_000_000, // 1.00 USD — value not exercised by these tests
        recorded_at,
    }
    .is_fresh(current_ledger, max_age_ledgers)
}

// ---------------------------------------------------------------------------
// AC-1: price just *within* the freshness window is accepted
// ---------------------------------------------------------------------------

/// A price recorded 1 ledger ago with a threshold of 5 is well within the
/// window and must be accepted.
#[test]
fn test_price_well_within_freshness_window_accepted() {
    let max_age = 5u32;
    let recorded_at = 100u32;
    let current = 104u32; // age = 4 — inside [0, 5]
    assert!(
        check(recorded_at, current, max_age),
        "price with age 4 should be fresh when max_age is 5"
    );
}

/// A price recorded exactly `max_age_ledgers - 1` ledgers ago (one ledger
/// inside the window) must be accepted.
#[test]
fn test_price_one_ledger_inside_window_accepted() {
    let max_age = 10u32;
    let recorded_at = 50u32;
    let current = 50 + max_age - 1; // age = max_age - 1 → fresh
    assert!(
        check(recorded_at, current, max_age),
        "price one ledger before window end should be fresh"
    );
}

// ---------------------------------------------------------------------------
// AC-2: price just *outside* the freshness window is rejected
// ---------------------------------------------------------------------------

/// A price recorded `max_age_ledgers + 1` ledgers ago must be rejected.
#[test]
fn test_price_one_ledger_outside_window_rejected() {
    let max_age = 10u32;
    let recorded_at = 50u32;
    let current = 50 + max_age + 1; // age = max_age + 1 → stale
    assert!(
        !check(recorded_at, current, max_age),
        "price one ledger past window end should be stale"
    );
}

/// A price recorded a very long time ago (many multiples of the threshold)
/// must be rejected.
#[test]
fn test_price_very_old_rejected() {
    let max_age = 100u32;
    let recorded_at = 0u32;
    let current = 10_000u32; // age = 10_000 >> 100
    assert!(
        !check(recorded_at, current, max_age),
        "very old price should be stale"
    );
}

// ---------------------------------------------------------------------------
// AC-3: exact threshold boundary handled correctly (fence-post tests)
// ---------------------------------------------------------------------------

/// A price recorded exactly `max_age_ledgers` ledgers ago sits on the
/// boundary.  The rule is `age <= max_age`, so the boundary price is *fresh*.
#[test]
fn test_price_at_exact_threshold_boundary_accepted() {
    let max_age = 17_280u32; // ≈24 h in ledgers (matches WINDOW_LEDGERS)
    let recorded_at = 1_000u32;
    let current = recorded_at + max_age; // age = max_age exactly
    assert!(
        check(recorded_at, current, max_age),
        "price at exact boundary (age == max_age) should be fresh"
    );
}

/// One ledger past the exact threshold must flip from fresh to stale.
#[test]
fn test_price_one_past_exact_threshold_rejected() {
    let max_age = 17_280u32;
    let recorded_at = 1_000u32;
    let current = recorded_at + max_age + 1; // age = max_age + 1
    assert!(
        !check(recorded_at, current, max_age),
        "price one ledger past exact boundary should be stale"
    );
}

/// A threshold of 0 means only a price recorded at the *current* ledger is
/// fresh; any earlier price is immediately stale.
#[test]
fn test_zero_threshold_only_current_ledger_is_fresh() {
    let max_age = 0u32;
    let current = 500u32;

    assert!(
        check(current, current, max_age),
        "price recorded at current ledger should be fresh with zero threshold"
    );
    assert!(
        !check(current - 1, current, max_age),
        "price recorded one ledger ago should be stale with zero threshold"
    );
}

/// Saturation guard: if `current_ledger < recorded_at` (clock skew / test
/// harness edge case) the subtraction saturates to 0, treating the price as
/// fresh rather than panicking.
#[test]
fn test_future_recorded_at_saturates_to_zero_age() {
    let max_age = 5u32;
    let recorded_at = 1_000u32;
    let current = 999u32; // current < recorded_at
    assert!(
        check(recorded_at, current, max_age),
        "recorded_at > current_ledger should saturate age to 0 (fresh)"
    );
}
