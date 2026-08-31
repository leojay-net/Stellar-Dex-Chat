//! Invariant tests for [`FiatBridge::get_withdrawal_request`].
//!
//! `get_withdrawal_request` is a pure view function that reads a
//! `WithdrawRequest` from persistent storage by queue id. The invariants
//! asserted here are:
//!
//! * For every accepted request the returned data matches what was stored.
//! * For non-existent ids the function returns `None`.
//! * The call never mutates storage — repeated reads are stable.
//! * A cancelled request becomes unreachable.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, BytesN, Env, Vec};

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

// ── Accepted request ──────────────────────────────────────────────────────

#[test]
fn stored_request_matches_inputs() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    fx.bridge.set_lock_period(&50);
    let user = funded_user(&env, &fx, 5_000);

    let memo = BytesN::from_array(&env, &[0xAB; 32]);
    let queued_at = env.ledger().sequence();
    let id = fx
        .bridge
        .request_withdrawal(&user, &750, &fx.token_addr, &Some(memo.clone()), &2);

    let stored = fx.bridge.get_withdrawal_request(&id).expect("must exist");
    assert_eq!(stored.to, user);
    assert_eq!(stored.token, fx.token_addr);
    assert_eq!(stored.amount, 750);
    assert_eq!(stored.memo_hash, Some(memo));
    assert_eq!(stored.risk_tier, 2);
    assert_eq!(stored.queued_ledger, queued_at);
    assert_eq!(stored.unlock_ledger, queued_at + 50);
}

#[test]
fn non_existent_id_returns_none() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    assert!(fx.bridge.get_withdrawal_request(&999).is_none());
}

#[test]
fn repeated_reads_are_stable() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);
    let id = fx
        .bridge
        .request_withdrawal(&user, &200, &fx.token_addr, &None, &0);

    let first = fx.bridge.get_withdrawal_request(&id);
    let second = fx.bridge.get_withdrawal_request(&id);
    let third = fx.bridge.get_withdrawal_request(&id);
    assert_eq!(first, second);
    assert_eq!(second, third);
}

#[test]
fn cancel_removes_request() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);
    let id = fx
        .bridge
        .request_withdrawal(&user, &300, &fx.token_addr, &None, &0);
    assert!(fx.bridge.get_withdrawal_request(&id).is_some());

    fx.bridge.cancel_withdrawal(&id);
    assert!(fx.bridge.get_withdrawal_request(&id).is_none());
}

#[test]
fn multiple_requests_all_reachable() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 50_000);

    let ids: Vec<u64> = Vec::from_array(
        &env,
        &[
            fx.bridge
                .request_withdrawal(&user, &100, &fx.token_addr, &None, &0),
            fx.bridge
                .request_withdrawal(&user, &200, &fx.token_addr, &None, &0),
            fx.bridge
                .request_withdrawal(&user, &300, &fx.token_addr, &None, &0),
        ],
    );

    for id in ids.iter() {
        assert!(fx.bridge.get_withdrawal_request(id).is_some());
    }
    assert_core_accounting_invariants(&fx);
}

#[test]
fn view_does_not_mutate_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);
    let id = fx
        .bridge
        .request_withdrawal(&user, &400, &fx.token_addr, &None, &0);

    let depth_before = fx.bridge.get_wq_depth();
    let _ = fx.bridge.get_withdrawal_request(&id);
    let _ = fx.bridge.get_withdrawal_request(&id);
    let _ = fx.bridge.get_withdrawal_request(&999);
    assert_eq!(fx.bridge.get_wq_depth(), depth_before);
    assert_core_accounting_invariants(&fx);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    #[test]
    fn fuzz_get_request_returns_none_for_any_absent_id(id in 10_000u64..u64::MAX) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);
        prop_assert!(fx.bridge.get_withdrawal_request(&id).is_none());
    }

    #[test]
    fn fuzz_valid_request_always_retrievable(
        deposit in 1_000i128..10_000,
        amount in 1i128..999,
        tier in 0u32..4,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);
        let user = funded_user(&env, &fx, deposit);

        let id = fx.bridge.request_withdrawal(&user, &amount, &fx.token_addr, &None, &tier);
        let stored = fx.bridge.get_withdrawal_request(&id);
        prop_assert!(stored.is_some(), "request must be retrievable after acceptance");
        let s = stored.unwrap();
        prop_assert_eq!(s.amount, amount);
        prop_assert_eq!(s.risk_tier, tier);
        prop_assert_eq!(s.to, user);
        prop_assert_eq!(s.token, fx.token_addr);
        assert_core_accounting_invariants(&fx);
    }
}
