//! Test for issue #1389: execute_admin_action deletes the queued action without applying it

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token, Address, Bytes, Env, IntoVal, Symbol, Vec,
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

fn u32_to_bytes(env: &Env, val: u32) -> Bytes {
    let mut bytes = Bytes::new(env);
    bytes.push_back((val >> 24) as u8);
    bytes.push_back((val >> 16) as u8);
    bytes.push_back((val >> 8) as u8);
    bytes.push_back(val as u8);
    bytes
}

#[test]
fn test_execute_admin_action_applies_set_lock() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, _, _, _) = setup_bridge(&env);

    // Set initial lock period
    bridge.set_lock_period(&100);

    // Queue a set_lock action
    let action_type = Symbol::new(&env, "set_lock");
    let payload = u32_to_bytes(&env, 200);
    let delay = 35_000; // Just above MIN_TIMELOCK_DELAY
    let action_id = bridge.queue_admin_action(&action_type, &payload, &delay);

    // Verify lock period is still 100
    assert_eq!(bridge.get_lock_period(), 100);

    // Advance ledger past the timelock
    env.ledger().set_sequence_number(35_001);

    // Execute the action
    bridge.execute_admin_action(&action_id);

    // Verify lock period is now 200
    assert_eq!(bridge.get_lock_period(), 200);

    // Verify action was removed from queue
    assert!(bridge.get_queued_admin_action(&action_id).is_none());
}

#[test]
fn test_execute_admin_action_not_ready_before_delay() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    // Set initial lock period
    bridge.set_lock_period(&100);

    // Queue a set_lock action
    let action_type = Symbol::new(&env, "set_lock");
    let payload = u32_to_bytes(&env, 200);
    let delay = 35_000;
    let action_id = bridge.queue_admin_action(&action_type, &payload, &delay);

    // Try to execute before delay
    env.ledger().set_sequence_number(34_999);
    let result = bridge.try_execute_admin_action(&action_id);
    assert_eq!(result, Err(Ok(Error::ActionNotReady)));

    // Verify lock period is still 100
    assert_eq!(bridge.get_lock_period(), 100);
}

#[test]
fn test_cancel_admin_action() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    // Set initial lock period
    bridge.set_lock_period(&100);

    // Queue a set_lock action
    let action_type = Symbol::new(&env, "set_lock");
    let payload = u32_to_bytes(&env, 200);
    let delay = 35_000;
    let action_id = bridge.queue_admin_action(&action_type, &payload, &delay);

    // Cancel the action
    bridge.cancel_admin_action(&action_id);

    // Verify action was removed from queue
    assert!(bridge.get_queued_admin_action(&action_id).is_none());

    // Advance ledger past the timelock
    env.ledger().set_sequence_number(35_001);

    // Try to execute - should fail because action was cancelled
    let result = bridge.try_execute_admin_action(&action_id);
    assert_eq!(result, Err(Ok(Error::ActionNotQueued)));

    // Verify lock period is still 100 (not changed)
    assert_eq!(bridge.get_lock_period(), 100);
}

#[test]
fn test_get_queued_admin_action_returns_option() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    // Try to get non-existent action
    let action = bridge.get_queued_admin_action(&999);
    assert!(action.is_none());

    // Queue an action
    let action_type = Symbol::new(&env, "set_lock");
    let payload = u32_to_bytes(&env, 200);
    let delay = 35_000;
    let action_id = bridge.queue_admin_action(&action_type, &payload, &delay);

    // Get the action
    let action = bridge.get_queued_admin_action(&action_id);
    assert!(action.is_some());
}
