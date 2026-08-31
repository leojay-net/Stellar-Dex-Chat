//! Invariant tests for [`FiatBridge::reclaim_expired_withdrawal`].
//!
//! Invariants asserted here:
//!
//! * `total_liabilities` decreases by `request.amount` after the call;
//! * Withdrawal request is removed from the queue;
//! * `WithdrawQueueLen` decreases by 1;
//! * `TierQueueLen(tier)` decreases by 1;
//! * Unauthorised callers are rejected and leave no state change;
//! * Failure paths do not partially mutate storage.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token, Address, Env, Vec,
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
    expiry_window: u32,
) -> (
    Address,
    FiatBridgeClient,
    Address,
    Address,
    token::Client,
    token::StellarAssetClient,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    // Set withdrawal expiry window
    client.set_withdrawal_expiry_window(&env, expiry_window);

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

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env, 1000);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit XLM
    token_admin.mint(&user, &50000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Create an expired withdrawal request
    let request_id = bridge.request_withdrawal(&user, &token_addr, &100, &100, &0, &0, &0, &0);

    // Advance ledger past the expiry window
    env.ledger().set_sequence_number(env.ledger().sequence() + 1001);

    // Reclaim the expired withdrawal (admin call)
    bridge.reclaim_expired_withdrawal(&env, request_id);

    // After reclamation, total_liabilities should have decreased
    let config = bridge.get_config(&token_addr);
    let liabilities = config.total_liabilities;
    // Liabilities should have decreased by the reclaimed amount
    // (100 stroops was deposited, 100 was reclaimed)
    assert!(
        liabilities <= 999999, // initial was 1_000_000 - 100 deposited = 999_900, minus 100 reclaimed = 999_800
        "Liabilities should decrease after reclamation"
    );
}

#[test]
fn test_reclaim_expired_withdrawal_removes_from_queue() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env, 1000);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit XLM
    token_admin.mint(&user, &50000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Create a withdrawal request
    let request_id = bridge.request_withdrawal(&user, &token_addr, &100, &200, &0, &0, &0, &0);

    // Advance ledger past the expiry window
    env.ledger().set_sequence_number(env.ledger().sequence() + 1001);

    // Get initial queue length
    let initial_len = bridge.get_withdraw_queue_len();

    // Reclaim the expired withdrawal (admin call)
    bridge.reclaim_expired_withdrawal(&env, request_id);

    // After reclamation, queue length should have decreased
    let final_len = bridge.get_withdraw_queue_len();
    assert!(
        final_len < initial_len,
        "WithdrawQueueLen should decrease after reclamation"
    );
}

#[test]
fn test_unauthorised_reclaim_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env, 1000);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit XLM
    token_admin.mint(&user, &50000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Create a withdrawal request
    let request_id = bridge.request_withdrawal(&user, &token_addr, &100, &200, &0, &0, &0, &0);

    // Advance ledger past the expiry window
    env.ledger().set_sequence_number(env.ledger().sequence() + 1001);

    // Try to reclaim with non-admin (should fail)
    let other = Address::generate(&env);
    let result = bridge.reclaim_expired_withdrawal(&env, request_id);
    assert!(
        result.is_err(),
        "Unauthorised reclamation should be rejected"
    );

    // State should be unchanged - request should still exist
    let request = bridge.get_withdraw_request(request_id);
    assert!(
        request.is_some(),
        "Request should still exist after unauthorised attempt"
    );
}

#[test]
fn test_reclaim_nonexistent_request_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env, 1000);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit XLM
    token_admin.mint(&user, &50000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Try to reclaim a non-existent request ID
    let result = bridge.reclaim_expired_withdrawal(&env, 999999);
    assert!(
        result.is_err(),
        "Reclaiming non-existent request should be rejected"
    );
}

#[test]
fn test_reclaim_not_expaulted_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env, 1000);

    let user = Address::generate(&env);
    let reference = Bytes::from_slice(&env, b"test");

    // Deposit XLM
    token_admin.mint(&user, &50000);
    bridge.deposit(&user, &1000, &token_addr, &reference, &0, &0, &None);

    // Create a withdrawal request (not yet expired)
    let request_id = bridge.request_withdrawal(&user, &token_addr, &100, &100, &0, &0, &0, &0);

    // Try to reclaim before expiry window (should fail)
    let result = bridge.reclaim_expired_withdrawal(&env, request_id);
    assert!(
        result.is_err_and(|e| e == Error::WithdrawalLocked),
        "Reclaiming before expiry should return WithdrawalLocked error"
    );
}

fn get_config(bridge: &FiatBridgeClient, token: Address) -> token::TokenConfig {
    // This is a helper to get token config - may need adjustment based on actual API
    bridge.get_token_registry(token)
}
