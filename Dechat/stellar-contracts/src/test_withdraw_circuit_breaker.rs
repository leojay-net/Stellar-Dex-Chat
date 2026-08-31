//! Regression tests for the withdrawal circuit-breaker guard.

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, Env, Vec};

fn setup(
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
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token = token::Client::new(env, &token_address);
    let token_admin = token::StellarAssetClient::new(env, &token_address);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);
    (
        contract_id,
        bridge,
        admin,
        token_address,
        token,
        token_admin,
    )
}

#[test]
fn tripped_circuit_breaker_rejects_withdrawal_without_moving_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, admin, token_address, token, token_admin) = setup(&env);
    let user = Address::generate(&env);
    token_admin.mint(&user, &1_000);
    bridge.deposit(
        &user,
        &1_000,
        &token_address,
        &Bytes::from_slice(&env, b"fund"),
        &0,
        &0,
        &None,
    );
    bridge.set_circuit_breaker_threshold(&100);

    // The threshold-reaching withdrawal succeeds and trips the breaker.
    bridge.withdraw(&admin, &user, &100, &token_address);
    assert!(bridge.is_circuit_breaker_tripped());
    let balance_before = token.balance(&contract_id);
    let withdrawn_before = bridge.get_total_withdrawn();

    assert_eq!(
        bridge.try_withdraw(&admin, &user, &1, &token_address),
        Err(Ok(Error::CircuitBreakerActive))
    );
    assert_eq!(token.balance(&contract_id), balance_before);
    assert_eq!(bridge.get_total_withdrawn(), withdrawn_before);
}
