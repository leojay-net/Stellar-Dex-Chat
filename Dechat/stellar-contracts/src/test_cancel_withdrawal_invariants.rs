//! Invariant tests for [`FiatBridge::cancel_withdrawal`].
//!
//! `cancel_withdrawal` removes a queued withdrawal request, decrements the
//! token's `total_liabilities`, shrinks the global queue length, advances
//! the queue head, performs per-tier bookkeeping, and emits
//! `WithdrawalCancelledEvent`. The invariants asserted here are:
//!
//! * **Core accounting invariants survive every cancellation.**
//! * **Liabilities decrease by exactly the cancelled amount.**
//! * **Queue depth shrinks by one per cancellation.**
//! * **The cancelled request is unreachable afterwards.**
//! * **Unauthorised callers are rejected and leave no state change.**
//! * **Cancellation while paused is rejected.**
//! * **Non-existent request ids are rejected.**
//! * **Failure paths do not partially mutate storage.**
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

// ── Accepted cancellations ────────────────────────────────────────────────

#[test]
fn cancel_decrements_liabilities_by_exact_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);

    let id = fx
        .bridge
        .request_withdrawal(&user, &400, &fx.token_addr, &None, &0);
    let liab_before = fx.bridge.get_total_liabilities();

    fx.bridge.cancel_withdrawal(&id);

    assert_eq!(fx.bridge.get_total_liabilities(), liab_before - 400);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn cancel_reduces_queue_depth_by_one() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);

    let _id1 = fx
        .bridge
        .request_withdrawal(&user, &100, &fx.token_addr, &None, &0);
    let id2 = fx
        .bridge
        .request_withdrawal(&user, &200, &fx.token_addr, &None, &0);
    assert_eq!(fx.bridge.get_wq_depth(), 2);

    fx.bridge.cancel_withdrawal(&id2);
    assert_eq!(fx.bridge.get_wq_depth(), 1);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn cancelled_request_is_unreachable() {
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
fn cancel_multiple_requests_maintains_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 50_000);

    let id1 = fx
        .bridge
        .request_withdrawal(&user, &1_000, &fx.token_addr, &None, &0);
    let id2 = fx
        .bridge
        .request_withdrawal(&user, &2_000, &fx.token_addr, &None, &0);
    let id3 = fx
        .bridge
        .request_withdrawal(&user, &3_000, &fx.token_addr, &None, &0);

    fx.bridge.cancel_withdrawal(&id2);
    assert_eq!(fx.bridge.get_wq_depth(), 2);
    assert_core_accounting_invariants(&fx);

    fx.bridge.cancel_withdrawal(&id1);
    assert_eq!(fx.bridge.get_wq_depth(), 1);
    assert_core_accounting_invariants(&fx);

    fx.bridge.cancel_withdrawal(&id3);
    assert_eq!(fx.bridge.get_wq_depth(), 0);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn cancel_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, _, token_admin) = {
        let fx = setup_bridge(&env);
        (
            fx.contract_id,
            fx.bridge,
            fx.admin,
            fx.token_addr,
            fx.token_client,
            fx.token_admin,
        )
    };
    let user = Address::generate(&env);
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let id = bridge.request_withdrawal(&user, &500, &token_addr, &None, &0);
    bridge.cancel_withdrawal(&id);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(!events.events().is_empty());
}

// ── Failure paths ─────────────────────────────────────────────────────────

#[test]
fn non_existent_request_id_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let before = fx.bridge.get_wq_depth();

    assert_eq!(
        fx.bridge.try_cancel_withdrawal(&999),
        Err(Ok(Error::RequestNotFound))
    );
    assert_eq!(fx.bridge.get_wq_depth(), before);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn cancelled_request_cannot_be_cancelled_again() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);
    let id = fx
        .bridge
        .request_withdrawal(&user, &200, &fx.token_addr, &None, &0);

    fx.bridge.cancel_withdrawal(&id);
    assert_eq!(
        fx.bridge.try_cancel_withdrawal(&id),
        Err(Ok(Error::RequestNotFound))
    );
    assert_core_accounting_invariants(&fx);
}

#[test]
fn paused_contract_rejects_cancellation() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);
    let id = fx
        .bridge
        .request_withdrawal(&user, &200, &fx.token_addr, &None, &0);
    let before_depth = fx.bridge.get_wq_depth();

    fx.bridge.pause();
    let result = fx.bridge.try_cancel_withdrawal(&id);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
    assert_eq!(fx.bridge.get_wq_depth(), before_depth);
    assert_core_accounting_invariants(&fx);
}

#[test]
fn unauthorised_caller_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 5_000);
    let id = fx
        .bridge
        .request_withdrawal(&user, &200, &fx.token_addr, &None, &0);

    env.set_auths(&[]);
    let result = fx.bridge.try_cancel_withdrawal(&id);
    assert!(result.is_err());

    env.mock_all_auths();
    assert!(fx.bridge.get_withdrawal_request(&id).is_some());
    assert_core_accounting_invariants(&fx);
}

#[test]
fn cancel_preserves_other_requests() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 50_000);

    let id1 = fx
        .bridge
        .request_withdrawal(&user, &100, &fx.token_addr, &None, &0);
    let id2 = fx
        .bridge
        .request_withdrawal(&user, &200, &fx.token_addr, &None, &0);
    let id3 = fx
        .bridge
        .request_withdrawal(&user, &300, &fx.token_addr, &None, &0);

    fx.bridge.cancel_withdrawal(&id2);

    assert!(fx.bridge.get_withdrawal_request(&id1).is_some());
    assert!(fx.bridge.get_withdrawal_request(&id2).is_none());
    assert!(fx.bridge.get_withdrawal_request(&id3).is_some());
    assert_eq!(fx.bridge.get_wq_depth(), 2);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    #[test]
    fn fuzz_cancel_decrements_liabilities_exactly(
        deposit in 1_000i128..10_000,
        amount in 1i128..999,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);
        let user = funded_user(&env, &fx, deposit);

        let liab_before = fx.bridge.get_total_liabilities();
        let id = fx.bridge.request_withdrawal(&user, &amount, &fx.token_addr, &None, &0);
        prop_assert_eq!(fx.bridge.get_total_liabilities(), liab_before + amount);

        fx.bridge.cancel_withdrawal(&id);
        prop_assert_eq!(fx.bridge.get_total_liabilities(), liab_before);
        prop_assert!(fx.bridge.get_withdrawal_request(&id).is_none());
        assert_core_accounting_invariants(&fx);
    }

    #[test]
    fn fuzz_nonexistent_id_always_rejected(id in 10_000u64..u64::MAX) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);
        prop_assert_eq!(
            fx.bridge.try_cancel_withdrawal(&id),
            Err(Ok(Error::RequestNotFound))
        );
        assert_core_accounting_invariants(&fx);
    }
}
