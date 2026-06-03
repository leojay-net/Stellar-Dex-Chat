#![cfg(test)]
//! Integration tests for issue #697 — daily limit validation in the withdrawal
//! quota path (`enforce_withdrawal_quota`).
//!
//! Covers:
//! * a withdrawal within the quota succeeding and emitting
//!   `WithdrawalQuotaConsumedEvent`,
//! * accumulation across multiple withdrawals up to the exact quota boundary,
//! * a withdrawal that would exceed the quota being rejected with
//!   `WithdrawalQuotaExceeded`,
//! * the 24-hour rolling window resetting (emitting `QuotaResetEvent`) so a
//!   user can withdraw again in a fresh window.

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Bytes, Env,
};

fn setup(env: &Env, tx_limit: i128) -> (Address, FiatBridgeClient<'_>, Address, Address, Address) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_sac = StellarAssetClient::new(env, &token_addr);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &tx_limit, &1, &signers, &1);

    let user = Address::generate(env);
    token_sac.mint(&user, &1_000_000);

    (contract_id, bridge, admin, token_addr, user)
}

/// Returns true if any event emitted by `contract_id` has `name` as its first
/// topic symbol. Mirrors the topic-matching approach used elsewhere in the
/// suite (e.g. the migration-check test).
fn event_emitted(env: &Env, contract_id: &Address, name: &str) -> bool {
    let events = env.events().all().filter_by_contract(contract_id);
    events.events().iter().any(|e| {
        // `ContractEventBody` currently has a single `V0` variant, so this
        // destructure is irrefutable.
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &e.body;
        !body.topics.is_empty()
            && matches!(
                &body.topics[0],
                soroban_sdk::xdr::ScVal::Symbol(sym)
                    if std::str::from_utf8(sym.0.as_slice()).unwrap() == name
            )
    })
}

#[test]
fn test_withdrawal_within_quota_succeeds_and_emits_consumed_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, user) = setup(&env, 10_000);
    bridge.set_withdrawal_quota(&2_000);

    // Fund the bridge escrow so withdrawals have liquidity.
    bridge.deposit(&user, &6_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // A withdrawal comfortably within the quota succeeds.
    bridge.withdraw(&admin, &user, &500, &token_addr);

    // Check the event before any further contract call, since the test env's
    // event buffer reflects the most recent invocation (and the getter below
    // is itself an invocation).
    assert!(event_emitted(
        &env,
        &contract_id,
        "withdrawal_quota_consumed_event"
    ));
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 500);
}

#[test]
fn test_withdrawals_accumulate_up_to_exact_quota_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let (_id, bridge, admin, token_addr, user) = setup(&env, 10_000);
    bridge.set_withdrawal_quota(&2_000);
    bridge.deposit(&user, &6_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // 1_500 + 500 == 2_000 (exactly the quota) is allowed.
    bridge.withdraw(&admin, &user, &1_500, &token_addr);
    bridge.withdraw(&admin, &user, &500, &token_addr);
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 2_000);

    // One stroop over the quota is rejected and the accumulator is unchanged.
    let res = bridge.try_withdraw(&admin, &user, &1, &token_addr);
    assert_eq!(res, Err(Ok(Error::WithdrawalQuotaExceeded)));
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 2_000);
}

#[test]
fn test_withdrawal_exceeding_quota_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_id, bridge, admin, token_addr, user) = setup(&env, 10_000);
    bridge.set_withdrawal_quota(&2_000);
    bridge.deposit(&user, &6_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let res = bridge.try_withdraw(&admin, &user, &2_001, &token_addr);
    assert_eq!(res, Err(Ok(Error::WithdrawalQuotaExceeded)));
    // Rejected withdrawal must not consume any quota.
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 0);
}

#[test]
fn test_quota_window_resets_after_24h() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, user) = setup(&env, 10_000);
    bridge.set_withdrawal_quota(&2_000);
    bridge.deposit(
        &user,
        &10_000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    // Consume most of the quota in the first window.
    bridge.withdraw(&admin, &user, &1_800, &token_addr);
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 1_800);

    // Advance just past the 24-hour rolling window (WINDOW_LEDGERS ≈ 17_280).
    env.ledger()
        .with_mut(|l| l.sequence_number += WINDOW_LEDGERS + 1);

    // The window has lapsed, so a fresh full-quota withdrawal succeeds and a
    // QuotaResetEvent is emitted. Check the event before the getter call.
    bridge.withdraw(&admin, &user, &1_800, &token_addr);
    assert!(event_emitted(&env, &contract_id, "quota_reset_event"));
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 1_800);
}
