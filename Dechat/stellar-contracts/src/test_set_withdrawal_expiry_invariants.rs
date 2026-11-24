//! Invariant tests for [`FiatBridge::set_withdrawal_expiry`].
//!
//! `set_withdrawal_expiry` stores a `WithdrawalExpiryWindow` (`u32`) in
//! instance storage. A value of `0` falls back to the compile-time default.
//! The invariants asserted here are:
//!
//! * The stored value matches the one just written (except `0` → default).
//! * Repeated writes converge to the latest value.
//! * Core accounting invariants survive every call.
//! * Unauthorised callers are rejected and leave no state change.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
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

struct Fixture<'a> {
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    admin: Address,
    token_addr: Address,
    token_client: token::Client<'a>,
    token_admin: token::StellarAssetClient<'a>,
}

fn setup_bridge(env: &Env) -> Fixture<'_> {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_addr = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_addr, &1_000_000, &100, &signers, &1, &0);

    Fixture {
        contract_id,
        bridge,
        admin,
        token_addr,
        token_client,
        token_admin,
    }
}

fn funded_user(env: &Env, fx: &Fixture<'_>, deposit: i128) -> Address {
    let user = Address::generate(env);
    fx.token_admin.mint(&user, &(deposit * 2));
    fx.bridge.deposit(
        &user,
        &deposit,
        &fx.token_addr,
        &Bytes::from_slice(env, b"seed"),
        &0,
        &0,
        &None,
    );
    user
}

fn assert_core_accounting_invariants(fx: &Fixture<'_>) {
    let deposited = fx.bridge.get_total_deposited();
    let withdrawn = fx.bridge.get_total_withdrawn();
    let liabilities = fx.bridge.get_total_liabilities();
    assert!(deposited >= withdrawn);
    let net = deposited - withdrawn;
    assert!(net >= liabilities);
    assert!(fx.token_client.balance(&fx.contract_id) >= net);
}

// ── Accepted writes ───────────────────────────────────────────────────────

#[test]
fn set_withdrawal_expiry_stores_nonzero_value() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    fx.bridge.set_withdrawal_expiry(&5_000);
    assert_eq!(fx.bridge.get_withdrawal_expiry(), 5_000);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn set_withdrawal_expiry_zero_falls_back_to_default() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    fx.bridge.set_withdrawal_expiry(&0);
    let stored = fx.bridge.get_withdrawal_expiry();
    assert!(stored > 0, "0 must fall back to the compile-time default");
    assert_core_accounting_invariants(&fx);
}

#[test]
fn set_withdrawal_expiry_overwrites_previous() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    fx.bridge.set_withdrawal_expiry(&1_000);
    assert_eq!(fx.bridge.get_withdrawal_expiry(), 1_000);

    fx.bridge.set_withdrawal_expiry(&9_999);
    assert_eq!(fx.bridge.get_withdrawal_expiry(), 9_999);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn set_withdrawal_expiry_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    fx.bridge.set_withdrawal_expiry(&3_000);
    fx.bridge.set_withdrawal_expiry(&3_000);
    fx.bridge.set_withdrawal_expiry(&3_000);

    assert_eq!(fx.bridge.get_withdrawal_expiry(), 3_000);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn set_withdrawal_expiry_does_not_affect_accounting() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let _user = funded_user(&env, &fx, 5_000);

    let dep_before = fx.bridge.get_total_deposited();
    let with_before = fx.bridge.get_total_withdrawn();
    let liab_before = fx.bridge.get_total_liabilities();

    fx.bridge.set_withdrawal_expiry(&7_777);

    assert_eq!(fx.bridge.get_total_deposited(), dep_before);
    assert_eq!(fx.bridge.get_total_withdrawn(), with_before);
    assert_eq!(fx.bridge.get_total_liabilities(), liab_before);
    assert_core_accounting_invariants(&fx);
}

// ── Failure paths ─────────────────────────────────────────────────────────

#[test]
fn unauthorised_caller_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let before = fx.bridge.get_withdrawal_expiry();

    env.set_auths(&[]);
    let result = fx.bridge.try_set_withdrawal_expiry(&5_000);
    assert!(result.is_err());

    env.mock_all_auths();
    assert_eq!(fx.bridge.get_withdrawal_expiry(), before);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn uninitialised_contract_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    assert_eq!(
        bridge.try_set_withdrawal_expiry(&1_000),
        Err(Ok(Error::NotInitialized))
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    #[test]
    fn fuzz_set_withdrawal_expiry_always_stores_latest(
        first in 1u32..100_000,
        second in 100_001u32..u32::MAX,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);

        fx.bridge.set_withdrawal_expiry(&first);
        prop_assert_eq!(fx.bridge.get_withdrawal_expiry(), first);

        fx.bridge.set_withdrawal_expiry(&second);
        prop_assert_eq!(fx.bridge.get_withdrawal_expiry(), second);
        assert_core_accounting_invariants(&fx);
    }

    #[test]
    fn fuzz_set_withdrawal_expiry_does_not_shift_accounting(
        deposit in 1_000i128..10_000,
        ledgers in 1u32..1_000_000,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);
        let _user = funded_user(&env, &fx, deposit);

        let dep = fx.bridge.get_total_deposited();
        let with = fx.bridge.get_total_withdrawn();
        let liab = fx.bridge.get_total_liabilities();

        fx.bridge.set_withdrawal_expiry(&ledgers);

        prop_assert_eq!(fx.bridge.get_total_deposited(), dep);
        prop_assert_eq!(fx.bridge.get_total_withdrawn(), with);
        prop_assert_eq!(fx.bridge.get_total_liabilities(), liab);
        assert_core_accounting_invariants(&fx);
    }
}
