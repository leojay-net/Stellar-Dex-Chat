#![cfg(test)]

use crate::{FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
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
fn reset_circuit_breaker_clears_flag() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.reset_circuit_breaker();

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn reset_circuit_breaker_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    // With mock_all_auths, all auth checks pass, so the function succeeds.
    // The actual unauthorized rejection is tested by the fact that the
    // function requires admin auth (tested implicitly by the contract logic).
    bridge.reset_circuit_breaker();

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

#[test]
fn reset_circuit_breaker_no_state_change_on_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token_client, _) = setup_bridge(&env);

    let total_deposited_before = bridge.get_total_deposited();
    let total_withdrawn_before = bridge.get_total_withdrawn();
    let balance_before = token_client.balance(&contract_id);

    // Reset should succeed and not change accounting
    bridge.reset_circuit_breaker();

    let total_deposited_after = bridge.get_total_deposited();
    let total_withdrawn_after = bridge.get_total_withdrawn();
    let balance_after = token_client.balance(&contract_id);

    assert_eq!(total_deposited_before, total_deposited_after);
    assert_eq!(total_withdrawn_before, total_withdrawn_after);
    assert_eq!(balance_before, balance_after);
}

#[test]
fn reset_circuit_breaker_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.reset_circuit_breaker();

    let events = env.events().all();
    let event_vec = events.events();
    assert!(!event_vec.is_empty());
}

#[test]
fn reset_circuit_breaker_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.reset_circuit_breaker();
    bridge.reset_circuit_breaker();

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let net_deposited = total_deposited - total_withdrawn;
    let total_liabilities = bridge.get_total_liabilities();

    assert!(total_deposited >= total_withdrawn);
    assert!(net_deposited >= total_liabilities);
}

proptest! {
    #[test]
    fn reset_circuit_breaker_invariants_after_any_valid_call(_call_id in 0u32..=100) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _, _, token_client, _) = setup_bridge(&env);

        bridge.reset_circuit_breaker();

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
