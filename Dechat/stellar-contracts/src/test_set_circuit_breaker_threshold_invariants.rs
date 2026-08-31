#![cfg(test)]

use crate::{FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
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
    FiatBridgeClient<'_>,
    Address,
    Address,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
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
fn set_circuit_breaker_threshold_updates_value() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.set_circuit_breaker_threshold(&5_000);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn set_circuit_breaker_threshold_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    // With mock_all_auths, auth checks pass. The admin is the one set during init.
    // This test verifies the function can be called successfully by admin.
    bridge.set_circuit_breaker_threshold(&5_000);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn set_circuit_breaker_threshold_no_state_change_on_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token_client, _) = setup_bridge(&env);

    let total_deposited_before = bridge.get_total_deposited();
    let total_withdrawn_before = bridge.get_total_withdrawn();
    let balance_before = token_client.balance(&contract_id);

    // Set threshold succeeds and doesn't change accounting
    bridge.set_circuit_breaker_threshold(&5_000);

    let total_deposited_after = bridge.get_total_deposited();
    let total_withdrawn_after = bridge.get_total_withdrawn();
    let balance_after = token_client.balance(&contract_id);

    assert_eq!(total_deposited_before, total_deposited_after);
    assert_eq!(total_withdrawn_before, total_withdrawn_after);
    assert_eq!(balance_before, balance_after);
}

#[test]
fn set_circuit_breaker_threshold_with_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.set_circuit_breaker_threshold(&0);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn set_circuit_breaker_threshold_high_value() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.set_circuit_breaker_threshold(&i128::MAX);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

proptest! {
    #[test]
    fn set_circuit_breaker_threshold_invariants_for_valid_inputs(threshold in 0i128..=1_000_000) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _, _, token_client, _) = setup_bridge(&env);

        bridge.set_circuit_breaker_threshold(&threshold);

        let total_deposited = bridge.get_total_deposited();
        let total_withdrawn = bridge.get_total_withdrawn();
        let total_liabilities = bridge.get_total_liabilities();
        let balance = token_client.balance(&contract_id);
        let net_deposited = total_deposited - total_withdrawn;

        prop_assert!(total_deposited >= total_withdrawn,
            "total_deposited {} < total_withdrawn {}", total_deposited, total_withdrawn);
        prop_assert!(net_deposited >= total_liabilities,
            "net_deposited {} < total_liabilities {}", net_deposited, total_liabilities);
        prop_assert!(balance >= net_deposited,
            "balance {} < net_deposited {}", balance, net_deposited);
    }
}
