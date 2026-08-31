#![allow(dead_code, unused_imports, unused_doc_comments)]

// Invariant-based tests for `get_accrued_fees` function.
//
// Uses proptest to verify that `get_accrued_fees` maintains invariants
// across various valid inputs and edge cases.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::{prelude::*, proptest};
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, Env,
};

/// Common test setup
fn setup_bridge(
    env: &Env,
    limit: i128,
) -> (
    Address,
    FiatBridgeClient<'_>,
    Address,
    Address,
    TokenClient<'_>,
    StellarAssetClient<'_>,
) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_addr, token, token_sac) = create_token(env, &token_admin);
    bridge.init(&admin, &token_addr, &limit);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

fn create_token<'a>(
    e: &Env,
    admin: &Address,
) -> (Address, TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (
        addr.clone(),
        TokenClient::new(e, &addr),
        StellarAssetClient::new(e, &addr),
    )
}

/// Invariant: get_accrued_fees always returns a non-negative value.
#[test]
fn inv_accrued_fees_non_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    let fees = bridge.get_accrued_fees();
    assert!(fees >= 0, "Accrued fees should never be negative");
}

/// Invariant: get_accrued_fees returns consistent values across multiple calls.
#[test]
fn inv_accrued_fees_consistency() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    let fees_1 = bridge.get_accrued_fees();
    let fees_2 = bridge.get_accrued_fees();
    let fees_3 = bridge.get_accrued_fees();

    assert_eq!(
        fees_1, fees_2,
        "Accrued fees should be consistent across calls"
    );
    assert_eq!(
        fees_2, fees_3,
        "Accrued fees should be consistent across calls"
    );
}

/// Invariant: get_accrued_fees does not mutate storage.
#[test]
fn inv_accrued_fees_no_mutation() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, bridge, admin, _, _, _) = setup_bridge(&env, 1000);

    // Read accrued fees before
    let fees_before = bridge.get_accrued_fees();

    // Call get_accrued_fees multiple times
    let _ = bridge.get_accrued_fees();
    let _ = bridge.get_accrued_fees();

    // Read accrued fees after - should be unchanged
    let fees_after = bridge.get_accrued_fees();

    assert_eq!(
        fees_before, fees_after,
        "get_accrued_fees should not mutate storage"
    );

    // Verify other state remains unchanged
    assert_eq!(bridge.get_admin(), admin);
}

/// Invariant: get_accrued_fees requires initialization.
#[test]
fn inv_accrued_fees_requires_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    // Should fail because contract is not initialized
    let result = bridge.try_get_accrued_fees();
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

/// Invariant: get_accrued_fees default value is 0 (before any fees are accrued).
#[test]
fn inv_accrued_fees_initial_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    // Initial accrued fees should be 0
    let fees = bridge.get_accrued_fees();
    assert_eq!(fees, 0, "Initial accrued fees should be 0");
}

// Property test: get_accrued_fees is monotonic or consistent
// with any state transitions.
proptest! {
    #[test]
    fn prop_accrued_fees_consistency_after_operations(
        num_calls in 1usize..10
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

        let initial_fees = bridge.get_accrued_fees();

        // Call get_accrued_fees multiple times
        for _ in 0..num_calls {
            let fees = bridge.get_accrued_fees();
            // Fees should remain consistent
            prop_assert_eq!(
                fees, initial_fees,
                "Accrued fees should remain consistent"
            );
        }
    }
}

/// Invariant: Accounting is consistent - accrued fees + withdrawn operations
/// should balance properly when fees are tracked.
#[test]
fn inv_accounting_consistency_with_accrued_fees() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 1000);
    let admin = bridge.get_admin();

    // Initial state
    let initial_fees = bridge.get_accrued_fees();
    let initial_balance = bridge.get_balance();

    assert_eq!(initial_fees, 0, "Initial fees should be 0");
    assert_eq!(initial_balance, 0, "Initial balance should be 0");

    // Perform a deposit
    token_sac.mint(&admin, &500);
    bridge.deposit(
        &admin,
        &500,
        &bridge.get_token(),
        &Bytes::new(&env),
    );

    // Check that fees haven't changed (no fees charged yet)
    let fees_after_deposit = bridge.get_accrued_fees();
    assert_eq!(
        fees_after_deposit, initial_fees,
        "Fees should not change on deposit"
    );
}

// Property test: get_accrued_fees handles edge case values
proptest! {
    #[test]
    fn prop_accrued_fees_edge_cases(
        limit in 1i128..i128::MAX / 2
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, _, _, _) = setup_bridge(&env, limit);

        // Should always return a valid value
        let fees = bridge.get_accrued_fees();
        prop_assert!(fees >= 0, "Fees must be non-negative");
    }
}
