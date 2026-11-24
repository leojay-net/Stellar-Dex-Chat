//! Test for issue #1387: set_operator consumes the operator's heartbeat nonce

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
fn test_set_operator_uses_admin_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Add operator
    bridge.set_operator(&operator, &true, &0);

    // Admin reads nonce
    let admin_nonce = bridge.get_set_operator_nonce(&admin);
    assert_eq!(admin_nonce, 1);

    // Operator sends heartbeat
    bridge.heartbeat(&operator, &0);

    // Admin's set_operator nonce should still be 1
    assert_eq!(bridge.get_set_operator_nonce(&admin), 1);

    // Operator's heartbeat nonce should be 1
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Admin's set_operator with nonce 1 should still succeed
    bridge.set_operator(&operator, &false, &1);

    // Verify operator is deactivated
    assert!(!bridge.is_operator(&operator));

    // Admin's nonce should now be 2
    assert_eq!(bridge.get_set_operator_nonce(&admin), 2);
}

#[test]
fn test_operator_heartbeat_does_not_affect_admin_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Add operator
    bridge.set_operator(&operator, &true, &0);

    // Operator sends multiple heartbeats
    bridge.heartbeat(&operator, &0);
    bridge.heartbeat(&operator, &1);
    bridge.heartbeat(&operator, &2);

    // Admin's set_operator nonce should still be 1
    assert_eq!(bridge.get_set_operator_nonce(&admin), 1);

    // Operator's heartbeat nonce should be 3
    assert_eq!(bridge.get_operator_nonce(&operator), 3);
}

#[test]
fn test_admin_set_operator_does_not_affect_operator_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env);
    let operator = Address::generate(&env);

    // Add operator
    bridge.set_operator(&operator, &true, &0);

    // Admin makes multiple set_operator calls
    bridge.set_operator(&operator, &false, &1);
    bridge.set_operator(&operator, &true, &2);

    // Operator's heartbeat nonce should still be 0
    assert_eq!(bridge.get_operator_nonce(&operator), 0);

    // Admin's set_operator nonce should be 3
    assert_eq!(bridge.get_set_operator_nonce(&admin), 3);
}
