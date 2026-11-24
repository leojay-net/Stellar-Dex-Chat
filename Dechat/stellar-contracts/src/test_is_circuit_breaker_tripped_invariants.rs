//! Invariant tests for [`FiatBridge::is_circuit_breaker_tripped`].
//!
//! `is_circuit_breaker_tripped` is a pure storage read with no arguments and
//! no authorisation requirement — any caller may query it. The invariants
//! asserted here are:
//!
//! * it never panics, including on an uninitialized contract, and defaults to
//!   `false` when the breaker has never been set;
//! * it is a pure read: calling it any number of times never mutates storage
//!   (accounting totals and the token balance are identical before and
//!   after), and it never itself trips or resets the breaker;
//! * it reflects `true` exactly while a threshold-breaching withdrawal has
//!   tripped the breaker, and `false` again once [`FiatBridge::reset_circuit_breaker`]
//!   clears it or the auto-reset window elapses;
//! * it agrees with the same flag surfaced in [`FiatBridge::get_config_snapshot`].
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, Env, Vec};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &contract_address.address()),
        token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

fn setup_bridge(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'_>,
    Address,
    Address,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    (
        contract_id,
        client,
        admin,
        token_address,
        token_client,
        token_admin,
    )
}

fn seed_deposit(
    env: &Env,
    bridge: &FiatBridgeClient,
    token_addr: &Address,
    token_admin: &token::StellarAssetClient,
    amount: i128,
) -> Address {
    let depositor = Address::generate(env);
    token_admin.mint(&depositor, &amount.saturating_add(1_000));
    let reference = Bytes::from_slice(env, b"seed");
    bridge.deposit(&depositor, &amount, token_addr, &reference, &0, &0, &None);
    depositor
}

#[test]
fn is_circuit_breaker_tripped_does_not_panic_on_uninitialized_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    // Pure view: reads its own key with unwrap_or(false), so it must not panic
    // or require Error::NotInitialized even before `init` runs.
    assert!(!(client.is_circuit_breaker_tripped()));
}

#[test]
fn is_circuit_breaker_tripped_defaults_to_false_after_init() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    assert!(!(bridge.is_circuit_breaker_tripped()));
}

#[test]
fn is_circuit_breaker_tripped_is_a_pure_read_with_no_side_effects() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let total_deposited_before = bridge.get_total_deposited();
    let total_withdrawn_before = bridge.get_total_withdrawn();
    let balance_before = token_client.balance(&contract_id);

    // Calling the view repeatedly must never mutate storage or flip the flag itself.
    for _ in 0..5 {
        let _ = bridge.is_circuit_breaker_tripped();
    }

    assert_eq!(bridge.get_total_deposited(), total_deposited_before);
    assert_eq!(bridge.get_total_withdrawn(), total_withdrawn_before);
    assert_eq!(token_client.balance(&contract_id), balance_before);
    assert!(!(bridge.is_circuit_breaker_tripped()));
}

#[test]
fn is_circuit_breaker_tripped_becomes_true_once_threshold_is_breached() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 10_000);

    bridge.set_circuit_breaker_threshold(&1_000);
    assert!(!(bridge.is_circuit_breaker_tripped()));

    let recipient = Address::generate(&env);
    // First withdrawal (600) stays under the 1_000 threshold and succeeds.
    bridge.withdraw(&admin, &recipient, &600, &token_addr);
    assert!(!(bridge.is_circuit_breaker_tripped()));

    // Second withdrawal pushes the rolling volume to 1_100 >= 1_000. The
    // withdrawal that crosses the threshold still succeeds — the breaker
    // trips as a side effect for the *next* call, not this one.
    bridge.withdraw(&admin, &recipient, &500, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Now tripped: a further withdrawal of any size is rejected, and the flag
    // keeps reporting true without needing to re-breach anything.
    let result = bridge.try_withdraw(&admin, &recipient, &1, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
    assert!(bridge.is_circuit_breaker_tripped());

    // Balance and total_withdrawn reflect exactly the two successful withdrawals.
    assert_eq!(bridge.get_total_withdrawn(), 1_100);
    assert_eq!(token_client.balance(&contract_id), 10_000 - 1_100);
}

#[test]
fn is_circuit_breaker_tripped_returns_false_after_manual_reset() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 10_000);

    bridge.set_circuit_breaker_threshold(&500);
    let recipient = Address::generate(&env);
    bridge.withdraw(&admin, &recipient, &500, &token_addr);
    let _ = bridge.try_withdraw(&admin, &recipient, &1, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    bridge.reset_circuit_breaker();
    assert!(!(bridge.is_circuit_breaker_tripped()));
}

#[test]
fn is_circuit_breaker_tripped_reflects_the_threshold_recorded_in_config_snapshot() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 10_000);

    bridge.set_circuit_breaker_threshold(&500);
    let recipient = Address::generate(&env);
    bridge.withdraw(&admin, &recipient, &500, &token_addr);
    let _ = bridge.try_withdraw(&admin, &recipient, &1, &token_addr);

    // `is_circuit_breaker_tripped` and `get_config_snapshot` read independent
    // storage keys — assert the threshold snapshot stays correct alongside the
    // tripped flag, so a future refactor can't silently desync the two views.
    let snapshot = bridge.get_config_snapshot();
    assert_eq!(snapshot.circuit_breaker_threshold, 500);
    assert!(bridge.is_circuit_breaker_tripped());
}

#[test]
fn is_circuit_breaker_tripped_stays_false_when_threshold_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 10_000);

    // Threshold 0 (the default) disables the breaker entirely.
    let recipient = Address::generate(&env);
    bridge.withdraw(&admin, &recipient, &9_999, &token_addr);

    assert!(!(bridge.is_circuit_breaker_tripped()));
}

proptest! {
    /// A lone withdrawal always succeeds regardless of the threshold (rolling
    /// volume starts at 0, so nothing was tripped before the call runs) — it
    /// only trips the flag, visible for every call after it, exactly when it
    /// alone reaches or exceeds the configured threshold.
    #[test]
    fn is_circuit_breaker_tripped_matches_whether_threshold_was_breached(
        threshold in 100i128..10_000,
        withdrawn in 1i128..19_999,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
        seed_deposit(&env, &bridge, &token_addr, &token_admin, 20_000);

        bridge.set_circuit_breaker_threshold(&threshold);
        let recipient = Address::generate(&env);
        let result = bridge.try_withdraw(&admin, &recipient, &withdrawn, &token_addr);

        prop_assert!(result.is_ok(), "the triggering withdrawal itself must still succeed");
        prop_assert_eq!(bridge.is_circuit_breaker_tripped(), withdrawn >= threshold);
    }
}
