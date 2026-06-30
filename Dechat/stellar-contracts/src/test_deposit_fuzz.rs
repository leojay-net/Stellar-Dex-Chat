#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _, token, Address, Bytes, Env, Vec,
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

proptest! {
    #[test]
    fn deposit_zero_amount_always_rejected(amount in 0i128..=0) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
        let user = Address::generate(&env);

        token_admin.mint(&user, &10_000);

        let reference = Bytes::from_slice(&env, b"test");
        let result = bridge.try_deposit(&user, &amount, &token_addr, &reference, &0, &0, &None);
        prop_assert_eq!(result, Err(Ok(Error::ZeroAmount)));
    }

    #[test]
    fn deposit_above_limit_always_rejected(amount in 1_000_001i128..=i128::MAX) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
        let user = Address::generate(&env);

        token_admin.mint(&user, &amount.saturating_add(1_000));

        let reference = Bytes::from_slice(&env, b"test");
        let result = bridge.try_deposit(&user, &amount, &token_addr, &reference, &0, &0, &None);
        prop_assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
    }

    #[test]
    fn deposit_valid_amounts_always_accepted(amount in 100i128..1_000_000) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, bridge, _, token_addr, _, token_admin) = setup_bridge(&env);
        let user = Address::generate(&env);

        token_admin.mint(&user, &amount.saturating_add(1_000));

        let reference = Bytes::from_slice(&env, b"test");
        let result = bridge.try_deposit(&user, &amount, &token_addr, &reference, &0, &0, &None);
        prop_assert!(result.is_ok(), "Valid deposit of {} should succeed", amount);
    }
}
