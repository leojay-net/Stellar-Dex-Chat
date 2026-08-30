#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token, Address, BytesN, Env, Vec,
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
fn execute_upgrade_without_proposal_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
}

#[test]
fn execute_upgrade_before_delay_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env);
    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);

    bridge.propose_upgrade(&wasm_hash);
    let proposal_before = bridge.get_upgrade_proposal().unwrap();
    let timing_before = bridge.get_upgrade_proposal_timing().unwrap();

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeNotReady)));
    assert_eq!(bridge.get_upgrade_proposal(), Some(proposal_before));
    assert_eq!(bridge.get_upgrade_proposal_timing(), Some(timing_before));
}

#[test]
fn execute_upgrade_no_proposal_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token_client, _) = setup_bridge(&env);

    let total_deposited_before = bridge.get_total_deposited();
    let total_withdrawn_before = bridge.get_total_withdrawn();
    let balance_before = token_client.balance(&contract_id);

    let _ = bridge.try_execute_upgrade();

    let total_deposited_after = bridge.get_total_deposited();
    let total_withdrawn_after = bridge.get_total_withdrawn();
    let balance_after = token_client.balance(&contract_id);

    assert_eq!(total_deposited_before, total_deposited_after);
    assert_eq!(total_withdrawn_before, total_withdrawn_after);
    assert_eq!(balance_before, balance_after);
}

proptest! {
    #[test]
    fn execute_upgrade_invariants_hold(
        _delay in 34_560u32..=100_000,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _, _, token_client, _) = setup_bridge(&env);

        let total_deposited_before = bridge.get_total_deposited();
        let total_withdrawn_before = bridge.get_total_withdrawn();
        let balance_before = token_client.balance(&contract_id);

        let _ = bridge.try_execute_upgrade();

        let total_deposited_after = bridge.get_total_deposited();
        let total_withdrawn_after = bridge.get_total_withdrawn();
        let balance_after = token_client.balance(&contract_id);

        prop_assert_eq!(total_deposited_before, total_deposited_after);
        prop_assert_eq!(total_withdrawn_before, total_withdrawn_after);
        prop_assert_eq!(balance_before, balance_after);
    }
}
