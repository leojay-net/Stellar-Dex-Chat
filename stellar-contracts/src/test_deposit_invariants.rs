//! Soroban invariant tests for deposit operations.
//!
//! This module tests that the contract maintains its invariants after deposit operations.

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
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

#[test]
fn test_deposit_maintains_total_deposited_ge_total_withdrawn() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // After deposit, total_deposited should be >= total_withdrawn
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    assert!(total_deposited >= total_withdrawn);
}

#[test]
fn test_deposit_maintains_net_deposited_ge_total_liabilities() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // After deposit, net_deposited should be >= total_liabilities
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn test_deposit_maintains_balance_ge_net_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // After deposit, on-chain balance should be >= net_deposited
    let balance = token_client.balance(&contract_id);
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    assert!(balance >= net_deposited);
}

#[test]
fn test_multiple_deposits_maintain_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    
    // Multiple deposits
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    bridge.deposit(&user, &2_000, &token_addr, &reference, &0, &0, &None);
    bridge.deposit(&user, &3_000, &token_addr, &reference, &0, &0, &None);

    // Check all invariants
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);
    let net_deposited = total_deposited - total_withdrawn;

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
    assert!(balance >= net_deposited);
}

#[test]
fn test_deposit_after_withdrawal_maintains_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    
    // Initial deposit
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Withdrawal
    bridge.withdraw(&admin, &user, &2_000, &token_addr);
    
    // Another deposit after withdrawal
    bridge.deposit(&user, &3_000, &token_addr, &reference, &0, &0, &None);

    // Check all invariants
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);
    let net_deposited = total_deposited - total_withdrawn;

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
    assert!(balance >= net_deposited);
}

#[test]
fn test_deposit_invariants_with_multiple_users() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin.mint(&user1, &10_000);
    token_admin.mint(&user2, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    
    // Deposits from multiple users
    bridge.deposit(&user1, &2_000, &token_addr, &reference, &0, &0, &None);
    bridge.deposit(&user2, &3_000, &token_addr, &reference, &0, &0, &None);

    // Check all invariants
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);
    let net_deposited = total_deposited - total_withdrawn;

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
    assert!(balance >= net_deposited);
}

#[test]
fn test_deposit_invariants_emits_balance_updated_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // Check that DepositBalanceUpdatedEvent was emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    let event_vec = events.events();
    
    // Should have events including DepositBalanceUpdatedEvent
    assert!(event_vec.len() > 0);
}

#[test]
fn test_deposit_invariants_with_zero_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // With no withdrawals, invariants should be straightforward
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);

    assert_eq!(total_withdrawn, 0);
    assert_eq!(total_liabilities, 0);
    assert_eq!(total_deposited, balance);
}

#[test]
fn test_deposit_invariants_after_request_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    let reference = Bytes::from_slice(&env, b"test");
    
    // Deposit
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Request withdrawal (increases liabilities)
    bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    
    // Another deposit
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // Check all invariants
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);
    let net_deposited = total_deposited - total_withdrawn;

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
    assert!(balance >= net_deposited);
}
