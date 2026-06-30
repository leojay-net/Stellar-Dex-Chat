//! Issue #572 — invariant tests for `request_withdrawal`.
//!
//! `request_withdrawal` queues a withdrawal and bumps the token's
//! `total_liabilities`. It calls `check_invariants` before returning, which
//! enforces the contract's core accounting invariants:
//!
//!   1. `total_deposited >= total_withdrawn`
//!   2. `net_deposited (= total_deposited - total_withdrawn) >= total_liabilities`
//!   3. `on_chain_balance >= net_deposited`
//!
//! These tests lock in those invariants for the `request_withdrawal` path,
//! plus the request-specific guarantees: liabilities grow by exactly the
//! requested amount, the queue depth increments by one, rejected requests
//! leave state untouched, and a `WithdrawalRequested` event is emitted.

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, Address, Bytes, Env, Vec,
};

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

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1);

    (
        contract_id,
        client,
        admin,
        token_address,
        token_client,
        token_admin,
    )
}

/// Fund `user` and deposit `amount` so the contract holds real tokens and has
/// a positive net position that withdrawals can be queued against.
fn fund_and_deposit(
    env: &Env,
    bridge: &FiatBridgeClient<'_>,
    token_admin: &token::StellarAssetClient<'_>,
    token_addr: &Address,
    user: &Address,
    amount: i128,
) {
    token_admin.mint(user, &amount);
    let reference = Bytes::from_slice(env, b"deposit-ref");
    bridge.deposit(user, &amount, token_addr, &reference, &0, &0, &None);
}

/// Invariant: a successful request increases `total_liabilities` by exactly the
/// requested amount and increments the queue depth by exactly one.
#[test]
fn test_request_withdrawal_invariant_liabilities_and_queue_grow_by_request() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    fund_and_deposit(&env, &bridge, &token_admin, &token_addr, &user, 5_000);

    let liabilities_before = bridge.get_total_liabilities();
    let depth_before = bridge.get_wq_depth();

    let request_id = bridge.request_withdrawal(&user, &1_200, &token_addr, &None, &0);

    assert_eq!(
        bridge.get_total_liabilities(),
        liabilities_before + 1_200,
        "liabilities must increase by exactly the requested amount",
    );
    assert_eq!(
        bridge.get_wq_depth(),
        depth_before + 1,
        "queue depth must increment by exactly one",
    );
    assert!(
        bridge.get_withdrawal_request(&request_id).is_some(),
        "the queued request must be retrievable by its id",
    );
}

/// Invariant 2 + 3: after queuing, `total_liabilities <= net_deposited` and the
/// on-chain balance still covers the net position (queuing moves no tokens).
#[test]
fn test_request_withdrawal_invariant_liabilities_covered_by_net_position() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    fund_and_deposit(&env, &bridge, &token_admin, &token_addr, &user, 5_000);

    bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    bridge.request_withdrawal(&user, &1_500, &token_addr, &None, &0);

    let net_deposited = bridge.get_total_deposited() - bridge.get_total_withdrawn();
    let liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);

    assert_eq!(liabilities, 3_500, "liabilities must accumulate additively");
    assert!(
        liabilities <= net_deposited,
        "invariant: queued liabilities must be covered by the net position",
    );
    assert!(
        balance >= net_deposited,
        "invariant: on-chain balance must cover the net position",
    );
}

/// Invariant: a request that would push `total_liabilities` beyond
/// `net_deposited` is rejected and leaves all state untouched (no partial
/// mutation of liabilities, queue depth, or request id counter).
#[test]
fn test_request_withdrawal_invariant_overcommit_rejected_and_state_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    fund_and_deposit(&env, &bridge, &token_admin, &token_addr, &user, 5_000);

    // First request consumes most of the net position.
    bridge.request_withdrawal(&user, &3_000, &token_addr, &None, &0);

    let liabilities_before = bridge.get_total_liabilities();
    let depth_before = bridge.get_wq_depth();

    // Second request (3_000) would make liabilities 6_000 > net_deposited 5_000.
    let result = bridge.try_request_withdrawal(&user, &3_000, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    assert_eq!(
        bridge.get_total_liabilities(),
        liabilities_before,
        "a rejected request must not change liabilities",
    );
    assert_eq!(
        bridge.get_wq_depth(),
        depth_before,
        "a rejected request must not change the queue depth",
    );

    // A subsequent request that fits the remaining net position still succeeds.
    let fitting_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    assert!(bridge.get_withdrawal_request(&fitting_id).is_some());
    assert_eq!(bridge.get_total_liabilities(), 5_000);
}

/// Invariant: a zero-amount request is rejected with `ZeroAmount` and does not
/// mutate liabilities or the queue.
#[test]
fn test_request_withdrawal_invariant_zero_amount_rejected_and_state_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    fund_and_deposit(&env, &bridge, &token_admin, &token_addr, &user, 5_000);

    let liabilities_before = bridge.get_total_liabilities();
    let depth_before = bridge.get_wq_depth();

    let result = bridge.try_request_withdrawal(&user, &0, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));

    assert_eq!(bridge.get_total_liabilities(), liabilities_before);
    assert_eq!(bridge.get_wq_depth(), depth_before);
}

/// Invariant: each successful request yields a distinct, monotonically
/// increasing request id, and every queued request stays retrievable.
#[test]
fn test_request_withdrawal_invariant_unique_monotonic_request_ids() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    fund_and_deposit(&env, &bridge, &token_admin, &token_addr, &user, 6_000);

    let id1 = bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);
    let id2 = bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);
    let id3 = bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);

    assert!(id2 > id1 && id3 > id2, "request ids must increase monotonically");
    assert!(bridge.get_withdrawal_request(&id1).is_some());
    assert!(bridge.get_withdrawal_request(&id2).is_some());
    assert!(bridge.get_withdrawal_request(&id3).is_some());
    assert_eq!(bridge.get_wq_depth(), 3);
    assert_eq!(bridge.get_total_liabilities(), 3_000);
}

/// Acceptance criterion: a successful request emits a contract event with a
/// non-empty topic set (the `WithdrawalRequested` event).
#[test]
fn test_request_withdrawal_invariant_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    fund_and_deposit(&env, &bridge, &token_admin, &token_addr, &user, 5_000);
    bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);

    let events = env.events().all().filter_by_contract(&contract_id);
    let event_vec = events.events();
    assert!(
        !event_vec.is_empty(),
        "request_withdrawal should emit at least one contract event",
    );

    let last_event = &event_vec[event_vec.len() - 1];
    use soroban_sdk::xdr::ContractEventBody;
    let ContractEventBody::V0(body) = &last_event.body;
    assert!(
        !body.topics.is_empty(),
        "the emitted withdrawal event must carry topics",
    );
}

/// Invariant: requesting against a token that is not whitelisted is rejected
/// and leaves the queue empty.
#[test]
fn test_request_withdrawal_invariant_unwhitelisted_token_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _token_addr, _, _) = setup_bridge(&env);
    let user = Address::generate(&env);

    // A token the contract has never registered.
    let stray_admin = Address::generate(&env);
    let (stray_token, _stray_sac) = create_token_contract(&env, &stray_admin);
    let stray_addr = stray_token.address.clone();

    let result = bridge.try_request_withdrawal(&user, &1_000, &stray_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::TokenNotWhitelisted)));
    assert_eq!(bridge.get_wq_depth(), 0, "a rejected request must not queue anything");
}
