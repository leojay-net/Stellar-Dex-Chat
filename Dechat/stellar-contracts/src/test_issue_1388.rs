//! Test for issue #1388: prune_inactive_operators never prunes operators that have never sent a heartbeat

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
fn test_prune_operator_without_heartbeat() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Set a short inactivity threshold for testing
    bridge.set_inactivity_threshold(&100);

    // Add an operator who never sends a heartbeat
    bridge.set_operator(&operator, &true, &0);

    // Verify operator is active
    assert!(bridge.is_operator(&operator));

    // Advance ledger past the inactivity threshold
    env.ledger().set_sequence_number(200);

    // Prune should deactivate the operator
    bridge.prune_inactive_operators();

    // Verify operator is now inactive
    assert!(!bridge.is_operator(&operator));

    // Verify OperatorPrunedEvent was emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    extern crate std;
    std::println!("ALL CONTRACT EVENTS: {:?}", events.events());
    std::println!("ALL EVENTS: {:?}", env.events().all().events());
    assert!(!events.events().is_empty());
}

#[test]
fn test_operator_not_pruned_before_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Set a short inactivity threshold for testing
    bridge.set_inactivity_threshold(&100);

    // Add an operator who never sends a heartbeat
    bridge.set_operator(&operator, &true, &0);

    // Verify operator is active
    assert!(bridge.is_operator(&operator));

    // Advance ledger but not past the inactivity threshold
    env.ledger().set_sequence_number(50);

    // Prune should NOT deactivate the operator yet
    bridge.prune_inactive_operators();

    // Verify operator is still active
    assert!(bridge.is_operator(&operator));
}

#[test]
fn test_operator_with_heartbeat_not_pruned_prematurely() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Set a short inactivity threshold for testing
    bridge.set_inactivity_threshold(&100);

    // Add an operator
    bridge.set_operator(&operator, &true, &0);

    // Operator sends a heartbeat
    bridge.heartbeat(&operator, &1);

    // Advance ledger but not past the inactivity threshold
    env.ledger().set_sequence_number(50);

    // Prune should NOT deactivate the operator
    bridge.prune_inactive_operators();

    // Verify operator is still active
    assert!(bridge.is_operator(&operator));
}

#[test]
fn test_operator_with_heartbeat_pruned_after_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Set a short inactivity threshold for testing
    bridge.set_inactivity_threshold(&100);

    // Add an operator
    bridge.set_operator(&operator, &true, &0);

    // Operator sends a heartbeat at ledger 0
    bridge.heartbeat(&operator, &1);

    // Advance ledger past the inactivity threshold
    env.ledger().set_sequence_number(200);

    // Prune should deactivate the operator
    bridge.prune_inactive_operators();

    // Verify operator is now inactive
    assert!(!bridge.is_operator(&operator));

    // Verify OperatorPrunedEvent was emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(!events.events().is_empty());
}
