//! Test for issue #1390: set_lock_period is unbounded, so request_withdrawal can panic on unlock_ledger overflow

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
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
fn test_set_lock_period_rejects_max() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    // Set lock period to u32::MAX should be rejected
    let result = bridge.try_set_lock_period(&u32::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_lock_period_accepts_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, _, _, _) = setup_bridge(&env);

    // Set lock period to MAX_LOCK_PERIOD should succeed
    bridge.set_lock_period(&6_307_200);

    assert_eq!(bridge.get_lock_period(), 6_307_200);

    // Verify SetLockPeriodEvent was emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(!events.events().is_empty());
}

#[test]
fn test_set_lock_period_rejects_exceeds_max() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    // Set lock period to MAX_LOCK_PERIOD + 1 should be rejected
    let result = bridge.try_set_lock_period(&6_307_201);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_request_withdrawal_uses_checked_add() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    // Set lock period to maximum allowed value
    bridge.set_lock_period(&6_307_200);

    // Deposit funds
    token_admin.mint(&user, &5_000);
    let reference = soroban_sdk::Bytes::from_slice(&env, b"test");
    bridge.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);

    // Set ledger to a high value near u32::MAX
    env.ledger().set_sequence_number(u32::MAX - 6_307_200);

    // request_withdrawal should not panic, but should return Overflow error
    let result = bridge.try_request_withdrawal(&user, &500, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::Overflow)));
}

#[test]
fn test_set_lock_batch_rejects_max() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    // Create a batch op with set_lock and u32::MAX
    let action_type = soroban_sdk::Symbol::new(&env, "set_lock");
    let mut payload = soroban_sdk::Bytes::new(&env);
    payload.push_back((u32::MAX >> 24) as u8);
    payload.push_back((u32::MAX >> 16) as u8);
    payload.push_back((u32::MAX >> 8) as u8);
    payload.push_back(u32::MAX as u8);

    let op = crate::BatchAdminOp {
        op_type: action_type,
        payload,
    };

    let mut operations = soroban_sdk::Vec::new(&env);
    operations.push_back(op);

    let result = bridge.try_execute_batch_admin(&operations);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}
