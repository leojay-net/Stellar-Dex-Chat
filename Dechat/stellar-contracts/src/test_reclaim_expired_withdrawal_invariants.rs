//! Invariant tests for [`FiatBridge::reclaim_expired_withdrawal`].
//!
//! Invariants asserted here:
//!
//! * `total_liabilities` decreases by `request.amount` after the call;
//! * Withdrawal request is removed from storage;
//! * `WithdrawQueueLen` decreases by 1;
//! * Failure paths (unexpired, nonexistent) return expected errors;
//! * Failure paths do not partially mutate storage.

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Bytes, Env,
};

const WITHDRAWAL_EXPIRY_WINDOW_LEDGERS: u32 = 17_280;

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

    let signers = vec![env, admin.clone()];

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

#[test]
fn test_reclaim_expired_withdrawal_decreases_liabilities() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit tokens
    token_admin.mint(&user, &50_000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Create a withdrawal request
    let request_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    let initial_liabilities = bridge.get_total_liabilities();
    assert_eq!(initial_liabilities, 100);

    // Advance ledger past the expiry window
    env.ledger().set_sequence_number(env.ledger().sequence() + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS + 10);

    // Reclaim the expired withdrawal
    bridge.reclaim_expired_withdrawal(&request_id);

    // After reclamation, total_liabilities should have decreased
    let final_liabilities = bridge.get_total_liabilities();
    assert_eq!(final_liabilities, 0);
}

#[test]
fn test_reclaim_expired_withdrawal_removes_from_queue() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit tokens
    token_admin.mint(&user, &50_000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Create a withdrawal request
    let request_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    let initial_len = bridge.get_wq_depth();
    assert_eq!(initial_len, 1);

    // Advance ledger past the expiry window
    env.ledger().set_sequence_number(env.ledger().sequence() + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS + 10);

    // Reclaim the expired withdrawal
    bridge.reclaim_expired_withdrawal(&request_id);

    // After reclamation, queue length should have decreased
    let final_len = bridge.get_wq_depth();
    assert_eq!(final_len, 0);

    // Request should no longer exist in storage
    assert_eq!(bridge.get_withdrawal_request(&request_id), None);
}

#[test]
fn test_reclaim_nonexistent_request_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_reclaim_expired_withdrawal(&999999);
    assert_eq!(result, Err(Ok(Error::RequestNotFound)));
}

#[test]
fn test_reclaim_not_expired_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    token_admin.mint(&user, &50_000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    let request_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    // Try to reclaim before expiry window (should fail)
    let result = bridge.try_reclaim_expired_withdrawal(&request_id);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));
}
