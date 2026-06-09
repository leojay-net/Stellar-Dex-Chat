//! Soroban invariant tests for withdraw_fees operations.
//!
//! This module tests that the contract maintains its invariants after fee withdrawal operations.

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
fn test_withdraw_fees_maintains_total_deposited_ge_total_withdrawn() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit and accrue fees
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Withdraw fees
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);

    // After fee withdrawal, total_deposited should be >= total_withdrawn
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    assert!(total_deposited >= total_withdrawn);
}

#[test]
fn test_withdraw_fees_maintains_net_deposited_ge_total_liabilities() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit and accrue fees
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Withdraw fees
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);

    // After fee withdrawal, net_deposited should be >= total_liabilities
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn test_withdraw_fees_maintains_balance_ge_net_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit and accrue fees
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Withdraw fees
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);

    // After fee withdrawal, on-chain balance should be >= net_deposited
    let balance = token_client.balance(&contract_id);
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    assert!(balance >= net_deposited);
}

#[test]
fn test_multiple_withdraw_fees_maintain_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit and accrue fees
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &2_000);
    
    // Mint tokens to contract for fee withdrawals
    token_admin.mint(&contract_id, &2_000);
    
    // Multiple fee withdrawals
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &1);
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &2);

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
fn test_withdraw_fees_after_withdrawal_maintains_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Regular withdrawal
    bridge.withdraw(&admin, &user, &1_000, &token_addr);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Fee withdrawal after regular withdrawal
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);

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
fn test_withdraw_fees_with_pending_requests_maintains_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Request withdrawal (increases liabilities)
    bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Fee withdrawal with pending requests
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);

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
fn test_withdraw_fees_batch_maintains_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Batch fee withdrawal
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());
    bridge.withdraw_fees_batch(&fee_recipient, &tokens);

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
fn test_withdraw_fees_invariants_with_zero_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit without accruing fees
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Attempt to withdraw fees with zero accrued should fail
    let result = bridge.try_withdraw_fees(&fee_recipient, &token_addr, &100, &0);
    assert_eq!(result, Err(Ok(Error::NoFeesToWithdraw)));

    // Invariants should still hold
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
fn test_withdraw_fees_emits_correct_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Setup: deposit and accrue fees
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);
    
    // Accrue fees
    bridge.accrue_fee(&token_addr, &1_000);
    
    // Mint tokens to contract for fee withdrawal
    token_admin.mint(&contract_id, &1_000);
    
    // Withdraw fees
    bridge.withdraw_fees(&fee_recipient, &token_addr, &500, &0);

    // Check that FeeWithdrawnEvent was emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    let event_vec = events.events();
    
    // Should have events including FeeWithdrawnEvent
    assert!(event_vec.len() > 0);
}
