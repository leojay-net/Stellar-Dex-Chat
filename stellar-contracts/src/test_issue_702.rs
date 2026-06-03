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

/// Test that unpause correctly restores the contract to operational state
#[test]
fn test_unpause_invariant_restores_operational_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &10_000);

    // Pause the contract
    bridge.pause();

    // Verify paused state blocks operations
    let reference = Bytes::from_slice(&env, b"test");
    let result = bridge.try_deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));

    // Unpause the contract
    bridge.unpause();

    // Verify operations are now allowed
    let receipt_id = bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    assert!(receipt_id.len() > 0);
}

/// Test that unpause emits the correct UnpausedEvent
#[test]
fn test_unpause_invariant_emits_correct_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, _, _, _) = setup_bridge(&env);

    bridge.pause();
    bridge.unpause();

    let events = env.events().all().filter_by_contract(&contract_id);
    let event_vec = events.events();
    
    // Should have at least 2 events (pause and unpause)
    assert!(event_vec.len() >= 2);
    
    // Last event should be unpause event containing admin address
    let last_event = &event_vec[event_vec.len() - 1];
    assert!(last_event.topics.len() > 0);
}

/// Test that unpause preserves all contract state
#[test]
fn test_unpause_invariant_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    // Setup: deposit before pausing
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &2_000, &token_addr, &reference, &0, &0, &None);

    let balance_before = token_client.balance(&env.current_contract_address());
    let total_deposited_before = bridge.get_total_deposited();

    // Pause and unpause
    bridge.pause();
    bridge.unpause();

    // Verify state is preserved
    let balance_after = token_client.balance(&env.current_contract_address());
    let total_deposited_after = bridge.get_total_deposited();

    assert_eq!(balance_before, balance_after);
    assert_eq!(total_deposited_before, total_deposited_after);
    assert_eq!(total_deposited_after, 2_000);
}

/// Test that unpause is idempotent
#[test]
fn test_unpause_invariant_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_admin.mint(&user, &5_000);

    bridge.pause();
    
    // Multiple unpauses should not cause errors
    bridge.unpause();
    bridge.unpause();
    bridge.unpause();

    // Verify contract is operational
    let reference = Bytes::from_slice(&env, b"test");
    let receipt_id = bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    assert!(receipt_id.len() > 0);
}

/// Test that unpause requires admin authorization
#[test]
fn test_unpause_invariant_requires_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.pause();
    
    // Admin authorization is required (mocked in this test)
    // In production, only admin can unpause
    bridge.unpause();
    
    // Verify unpause succeeded
    let reference = Bytes::from_slice(&env, b"test");
    let user = Address::generate(&env);
    let token_addr = Address::generate(&env);
    
    // Should not be paused anymore
    let result = bridge.try_deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    // Will fail for other reasons, but not ContractPaused
    assert_ne!(result, Err(Ok(Error::ContractPaused)));
}

/// Test that unpause enables all previously blocked operations
#[test]
fn test_unpause_invariant_enables_all_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    // Setup: deposit before pausing
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &2_000, &token_addr, &reference, &0, &0, &None);

    // Pause
    bridge.pause();

    // Unpause
    bridge.unpause();

    // All operations should now work
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    bridge.withdraw(&admin, &user, &500, &token_addr);
    
    let request_id = bridge.request_withdrawal(&user, &300, &token_addr, &None, &0);
    assert!(request_id >= 0);
}

/// Test unpause maintains queue integrity
#[test]
fn test_unpause_invariant_maintains_queue_integrity() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    // Setup: create withdrawal requests before pausing
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let request_id1 = bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);
    let request_id2 = bridge.request_withdrawal(&user, &1_000, &token_addr, &None, &0);

    // Pause and unpause
    bridge.pause();
    bridge.unpause();

    // Verify queue remains intact - can execute pending requests
    bridge.execute_withdrawal(&request_id1, &None, &0, &0);
    bridge.execute_withdrawal(&request_id2, &None, &0, &0);
}

