#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
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

/// Test fee accrual vault integration with withdraw_fees
#[test]
fn test_withdraw_fees_deducts_from_accrued_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Accrue fees
    bridge.accrue_fee(&token_addr, &5_000);

    // Transfer tokens to contract to cover fees
    token_client.mint(&contract_id, &5_000);

    let initial_vault = bridge.get_accrued_fees(&token_addr);
    assert_eq!(initial_vault, 5_000);

    // Withdraw fees
    bridge.withdraw_fees(&recipient, &token_addr, &2_000, &0);

    // Verify vault was deducted
    let remaining_vault = bridge.get_accrued_fees(&token_addr);
    assert_eq!(remaining_vault, 3_000);

    // Verify recipient received tokens
    assert_eq!(token_client.balance(&recipient), 2_000);
}

/// Test withdraw_fees fails when vault balance is insufficient
#[test]
fn test_withdraw_fees_fails_when_vault_insufficient() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Accrue only 1000 fees
    bridge.accrue_fee(&token_addr, &1_000);
    token_client.mint(&contract_id, &1_000);

    // Attempt to withdraw more than accrued
    let result = bridge.try_withdraw_fees(&recipient, &token_addr, &2_000, &0);
    
    assert_eq!(result, Err(Ok(Error::FeeWithdrawalExceedsBalance)));
}

/// Test withdraw_fees emits correct event with vault information
#[test]
fn test_withdraw_fees_emits_vault_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Accrue fees
    bridge.accrue_fee(&token_addr, &10_000);
    token_client.mint(&contract_id, &10_000);

    // Withdraw fees
    bridge.withdraw_fees(&recipient, &token_addr, &3_000, &0);

    // Check events
    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(events.events().len() > 0);
}

/// Test fee accrual vault handles multiple withdrawals correctly
#[test]
fn test_withdraw_fees_multiple_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Accrue fees
    bridge.accrue_fee(&token_addr, &10_000);
    token_client.mint(&contract_id, &10_000);

    // First withdrawal
    bridge.withdraw_fees(&recipient, &token_addr, &2_000, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 8_000);

    // Second withdrawal
    bridge.withdraw_fees(&recipient, &token_addr, &3_000, &1);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 5_000);

    // Third withdrawal
    bridge.withdraw_fees(&recipient, &token_addr, &5_000, &2);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);

    // Verify total received
    assert_eq!(token_client.balance(&recipient), 10_000);
}

/// Test withdraw_fees respects nonce for replay protection
#[test]
fn test_withdraw_fees_vault_nonce_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    bridge.accrue_fee(&token_addr, &5_000);
    token_client.mint(&contract_id, &5_000);

    // First withdrawal with nonce 0
    bridge.withdraw_fees(&recipient, &token_addr, &1_000, &0);

    // Attempt replay with same nonce should fail
    let result = bridge.try_withdraw_fees(&recipient, &token_addr, &1_000, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Next withdrawal must use incremented nonce
    bridge.withdraw_fees(&recipient, &token_addr, &1_000, &1);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 3_000);
}

/// Test withdraw_fees_batch uses fee accrual vault correctly
#[test]
fn test_withdraw_fees_batch_uses_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let (token_client2, token_admin2) = create_token_contract(&env, &admin);
    let token_addr2 = token_client2.address.clone();
    let recipient = Address::generate(&env);

    // Accrue fees for multiple tokens
    bridge.accrue_fee(&token_addr, &3_000);
    bridge.accrue_fee(&token_addr2, &2_000);

    token_client.mint(&contract_id, &3_000);
    token_client2.mint(&contract_id, &2_000);

    // Batch withdraw
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());
    tokens.push_back(token_addr2.clone());
    
    bridge.withdraw_fees_batch(&recipient, &tokens);

    // Verify vaults are drained
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
    assert_eq!(bridge.get_accrued_fees(&token_addr2), 0);

    // Verify recipient received tokens
    assert_eq!(token_client.balance(&recipient), 3_000);
    assert_eq!(token_client2.balance(&recipient), 2_000);
}

/// Test fee vault reconciliation with withdraw_fees
#[test]
fn test_withdraw_fees_vault_reconciliation() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Accrue fees
    bridge.accrue_fee(&token_addr, &10_000);
    
    // Only mint partial amount to contract
    token_client.mint(&contract_id, &5_000);

    // Attempt to withdraw full accrued amount should fail
    let result = bridge.try_withdraw_fees(&recipient, &token_addr, &10_000, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    // Withdraw available amount
    bridge.withdraw_fees(&recipient, &token_addr, &5_000, &0);
    assert_eq!(token_client.balance(&recipient), 5_000);
}

/// Test withdraw_fees with zero accrued fees
#[test]
fn test_withdraw_fees_with_zero_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // No fees accrued
    let result = bridge.try_withdraw_fees(&recipient, &token_addr, &1_000, &0);
    assert_eq!(result, Err(Ok(Error::NoFeesToWithdraw)));
}

/// Test accrued fees persist across operations
#[test]
fn test_withdraw_fees_vault_persistence() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token_client, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Accrue fees in multiple steps
    bridge.accrue_fee(&token_addr, &1_000);
    bridge.accrue_fee(&token_addr, &2_000);
    bridge.accrue_fee(&token_addr, &1_500);

    let total_accrued = bridge.get_accrued_fees(&token_addr);
    assert_eq!(total_accrued, 4_500);

    // Mint tokens and withdraw
    token_client.mint(&contract_id, &4_500);
    bridge.withdraw_fees(&recipient, &token_addr, &4_500, &0);

    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}

