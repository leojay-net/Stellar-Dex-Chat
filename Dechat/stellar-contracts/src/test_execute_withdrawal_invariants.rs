//! Invariant tests for [`FiatBridge::execute_withdrawal`].
//!
//! `execute_withdrawal` processes a queued withdrawal request, transfers tokens
//! from the contract to the user, updates accounting totals, and maintains the
//! following core invariants:
//!
//! * `total_deposited >= total_withdrawn` — the contract never withdraws more
//!   than has been deposited;
//! * `net_deposited (total_deposited - total_withdrawn) >= total_liabilities`
//!   — outstanding withdrawal liabilities never exceed net held funds;
//! * on-chain token balance `>= net_deposited` — actual contract tokens cover
//!   all depositor claims;
//! * Accounting consistency: `total_withdrawn` increases by the executed amount,
//!   `total_liabilities` decreases by the executed amount, and `total_deposited`
//!   remains invariant;
//! * Replay protection: each recipient has a strictly monotonic execution nonce;
//! * Atomicity: failed or unauthorised calls revert completely and do not mutate
//!   contract storage or token balances.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
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

    // Lock period = 100 ledgers
    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);
    client.set_lock_period(&100);

    (
        contract_id,
        client,
        admin,
        token_address,
        token_client,
        token_admin,
    )
}

#[test]
fn test_execute_withdrawal_maintains_total_deposited_ge_total_withdrawn() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);

    // Advance ledger past lock period (100 ledgers)
    env.ledger().with_mut(|l| l.sequence_number += 105);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &nonce);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    assert!(total_deposited >= total_withdrawn);
}

#[test]
fn test_execute_withdrawal_maintains_net_deposited_ge_total_liabilities() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &20_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &10_000, &token_addr, &reference, &0, &0, &None);

    let req_id1 = bridge.request_withdrawal(&user, &3_000, &token_addr, &None, &0);
    let _req_id2 = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);

    env.ledger().with_mut(|l| l.sequence_number += 105);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id1, &None, &0, &0, &nonce);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(net_deposited >= total_liabilities);
}

#[test]
fn test_execute_withdrawal_maintains_balance_ge_net_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &20_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &8_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &3_000, &token_addr, &None, &0);

    env.ledger().with_mut(|l| l.sequence_number += 105);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &nonce);

    let balance = token_client.balance(&contract_id);
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;

    assert!(balance >= net_deposited);
}

#[test]
fn test_execute_withdrawal_exact_accounting_deltas() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let withdraw_amount = 2_000;
    let req_id = bridge.request_withdrawal(&user, &withdraw_amount, &token_addr, &None, &0);

    env.ledger().with_mut(|l| l.sequence_number += 105);

    let dep_before = bridge.get_total_deposited();
    let with_before = bridge.get_total_withdrawn();
    let liab_before = bridge.get_total_liabilities();
    let user_bal_before = token_client.balance(&user);
    let contract_bal_before = token_client.balance(&contract_id);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &nonce);

    let dep_after = bridge.get_total_deposited();
    let with_after = bridge.get_total_withdrawn();
    let liab_after = bridge.get_total_liabilities();
    let user_bal_after = token_client.balance(&user);
    let contract_bal_after = token_client.balance(&contract_id);

    assert_eq!(dep_after, dep_before, "total_deposited must be invariant");
    assert_eq!(with_after, with_before + withdraw_amount, "total_withdrawn delta mismatch");
    assert_eq!(liab_after, liab_before - withdraw_amount, "total_liabilities delta mismatch");
    assert_eq!(user_bal_after, user_bal_before + withdraw_amount, "user balance delta mismatch");
    assert_eq!(contract_bal_after, contract_bal_before - withdraw_amount, "contract balance delta mismatch");
}

#[test]
fn test_partial_execute_withdrawal_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &6_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &4_000, &token_addr, &None, &0);

    env.ledger().with_mut(|l| l.sequence_number += 105);

    let partial_amount = 1_500;
    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id, &Some(partial_amount), &0, &0, &nonce);

    // Invariants check
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);
    let net_deposited = total_deposited - total_withdrawn;

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
    assert!(balance >= net_deposited);

    // Remaining request verification
    let remaining_req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(remaining_req.amount, 4_000 - partial_amount);

    // Queue length should remain unchanged for partial withdrawal
    assert_eq!(bridge.get_wq_depth(), 1);
}

#[test]
fn test_full_execute_withdrawal_removes_from_queue() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 1);

    env.ledger().with_mut(|l| l.sequence_number += 105);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &nonce);

    assert_eq!(bridge.get_withdrawal_request(&req_id), None);
    assert_eq!(bridge.get_wq_depth(), 0);
}

#[test]
fn test_execute_withdrawal_replay_protection_nonce_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);

    env.ledger().with_mut(|l| l.sequence_number += 105);

    // Initial nonce must be 0
    let initial_nonce = bridge.get_withdrawal_execution_nonce(&user);
    assert_eq!(initial_nonce, 0);

    // Attempting invalid future nonce fails with InvalidNonce and no state mutation
    let invalid_result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0, &5);
    assert_eq!(invalid_result, Err(Ok(Error::InvalidNonce)));
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(token_client.balance(&contract_id), 5_000);

    // Execute successfully with correct nonce 0
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &0);
    let next_nonce = bridge.get_withdrawal_execution_nonce(&user);
    assert_eq!(next_nonce, 1);

    // Second request to test stale nonce rejection
    let req_id2 = bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);
    env.ledger().with_mut(|l| l.sequence_number += 105);

    // Attempting stale nonce 0 fails with StaleNonce and no state mutation
    let stale_result = bridge.try_execute_withdrawal(&req_id2, &None, &0, &0, &0);
    assert_eq!(stale_result, Err(Ok(Error::StaleNonce)));
    assert_eq!(bridge.get_total_withdrawn(), 2_000);
    assert_eq!(bridge.get_withdrawal_execution_nonce(&user), 1);
}

#[test]
fn test_execute_withdrawal_locked_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);

    // Do NOT advance sequence past lock period (100 ledgers)
    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0, &nonce);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    // State must be completely unmutated
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(bridge.get_total_liabilities(), 2_000);
    assert_eq!(token_client.balance(&contract_id), 5_000);
    assert_eq!(token_client.balance(&user), 5_000);
}

#[test]
fn test_execute_withdrawal_paused_fails_without_mutation() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    env.ledger().with_mut(|l| l.sequence_number += 105);

    bridge.pause();

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0, &nonce);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));

    // Verify no state change occurred
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(token_client.balance(&contract_id), 5_000);
}

#[test]
fn test_execute_withdrawal_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    env.ledger().with_mut(|l| l.sequence_number += 105);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &nonce);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(!events.events().is_empty());
}

proptest! {
    #[test]
    fn fuzz_execute_withdrawal_valid_amounts(amount in 100i128..=5_000i128) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
        let user = Address::generate(&env);

        token_admin.mint(&user, &(amount + 1_000));
        let reference = Bytes::from_slice(&env, b"fuzz_test");
        bridge.deposit(&user, &amount, &token_addr, &reference, &0, &0, &None);

        let req_id = bridge.request_withdrawal(&user, &amount, &token_addr, &None, &0);
        env.ledger().with_mut(|l| l.sequence_number += 105);

        let nonce = bridge.get_withdrawal_execution_nonce(&user);
        let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0, &nonce);
        prop_assert!(result.is_ok(), "Valid execute_withdrawal failed: {:?}", result);

        let total_deposited = bridge.get_total_deposited();
        let total_withdrawn = bridge.get_total_withdrawn();
        let total_liabilities = bridge.get_total_liabilities();
        let balance = token_client.balance(&contract_id);
        let net_deposited = total_deposited - total_withdrawn;

        prop_assert!(total_deposited >= total_withdrawn);
        prop_assert!(net_deposited >= total_liabilities);
        prop_assert!(balance >= net_deposited);
    }

    #[test]
    fn fuzz_execute_withdrawal_invalid_partial_amounts(partial in -1000i128..=0i128) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
        let user = Address::generate(&env);

        token_admin.mint(&user, &10_000);
        let reference = Bytes::from_slice(&env, b"fuzz_test");
        bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

        let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
        env.ledger().with_mut(|l| l.sequence_number += 105);

        let nonce = bridge.get_withdrawal_execution_nonce(&user);
        let result = bridge.try_execute_withdrawal(&req_id, &Some(partial), &0, &0, &nonce);
        prop_assert_eq!(result, Err(Ok(Error::ZeroAmount)));
    }

    #[test]
    fn fuzz_execute_withdrawal_excess_partial_amounts(excess in 1i128..=1000i128) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
        let user = Address::generate(&env);

        token_admin.mint(&user, &10_000);
        let reference = Bytes::from_slice(&env, b"fuzz_test");
        bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

        let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
        env.ledger().with_mut(|l| l.sequence_number += 105);

        let partial = 2_000 + excess;
        let nonce = bridge.get_withdrawal_execution_nonce(&user);
        let result = bridge.try_execute_withdrawal(&req_id, &Some(partial), &0, &0, &nonce);
        prop_assert_eq!(result, Err(Ok(Error::ZeroAmount)));
    }
}
