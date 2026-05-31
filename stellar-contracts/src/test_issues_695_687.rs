#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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

#[test]
fn test_withdraw_fees_replay_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1);

    // Mint tokens to contract
    token_admin.mint(&contract_id, &10_000);

    // Simulate fee accrual by depositing
    token_admin.mint(&user, &5_000);
    let reference = soroban_sdk::Bytes::from_slice(&env, b"test");
    client.deposit(&user, &5_000, &token_address, &reference, &100, &500, &None);

    // Get initial nonce (should be 0)
    let nonce = client.get_fee_withdrawal_nonce(&admin);
    assert_eq!(nonce, 0);

    // First withdrawal with correct nonce should succeed
    client.withdraw_fees(&user, &token_address, &100, &0);

    // Nonce should be incremented
    let nonce_after = client.get_fee_withdrawal_nonce(&admin);
    assert_eq!(nonce_after, 1);

    // Try to replay with old nonce - should fail
    let result = client.try_withdraw_fees(&user, &token_address, &100, &0);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Using correct nonce should work
    client.withdraw_fees(&user, &token_address, &100, &1);
    let nonce_final = client.get_fee_withdrawal_nonce(&admin);
    assert_eq!(nonce_final, 2);
}

#[test]
fn test_withdraw_fees_nonce_skipping_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1);

    token_admin.mint(&contract_id, &10_000);
    token_admin.mint(&user, &5_000);
    let reference = soroban_sdk::Bytes::from_slice(&env, b"test");
    client.deposit(&user, &5_000, &token_address, &reference, &100, &500, &None);

    // Try to use nonce 5 when current is 0 - should fail
    let result = client.try_withdraw_fees(&user, &token_address, &100, &5);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));
}

#[test]
fn test_request_withdrawal_edge_cases() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1);

    // Test 1: Request withdrawal with no balance should fail
    let result = client.try_request_withdrawal(&user, &1_000, &token_address, &None, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    // Test 2: Deposit some funds
    token_admin.mint(&user, &5_000);
    let reference = soroban_sdk::Bytes::from_slice(&env, b"test");
    client.deposit(&user, &5_000, &token_address, &reference, &100, &500, &None);

    // Test 3: Request withdrawal to contract itself should fail
    let result = client.try_request_withdrawal(&contract_id, &1_000, &token_address, &None, &0);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));

    // Test 4: Request withdrawal exceeding balance should fail
    let result = client.try_request_withdrawal(&user, &10_000, &token_address, &None, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    // Test 5: Valid withdrawal request should succeed
    let request_id = client.request_withdrawal(&user, &1_000, &token_address, &None, &0);
    assert_eq!(request_id, 0);
}

#[test]
fn test_request_withdrawal_liability_overflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1);

    // Deposit funds
    token_admin.mint(&user, &5_000);
    let reference = soroban_sdk::Bytes::from_slice(&env, b"test");
    client.deposit(&user, &5_000, &token_address, &reference, &100, &500, &None);

    // Request withdrawal that would exceed net deposited
    // This should fail because liabilities can't exceed net deposits
    let result = client.try_request_withdrawal(&user, &6_000, &token_address, &None, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_request_withdrawal_unwhitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (token_client, _token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();

    // Create another token that's not whitelisted
    let (unwhitelisted_token, _) = create_token_contract(&env, &admin);
    let unwhitelisted_address = unwhitelisted_token.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1);

    // Try to request withdrawal for unwhitelisted token
    let result = client.try_request_withdrawal(&user, &1_000, &unwhitelisted_address, &None, &0);
    assert_eq!(result, Err(Ok(Error::TokenNotWhitelisted)));
}
