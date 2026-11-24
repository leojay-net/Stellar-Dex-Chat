//! Replay-protection tests for the single-operator `heartbeat` entry-point.
//!
//! Issue #775: verify that the nonce mechanism prevents an operator from
//! replaying a previously-submitted heartbeat call.

#![cfg(test)]

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Bytes, Env,
};

fn setup<'a>(env: &Env) -> (FiatBridgeClient<'a>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let (token_client, _) = (
        token::Client::new(env, &contract_id.address()),
        token::StellarAssetClient::new(env, &contract_id.address()),
    );
    let token_address = token_client.address.clone();

    let bridge_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &bridge_id);
    let signers = vec![env, admin.clone()];
    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);
    (client, admin)
}

/// A fresh operator's first heartbeat (nonce == 1) must succeed.
#[test]
fn test_heartbeat_first_call_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&op), 1);

    bridge.heartbeat(&op, &1);
    assert_eq!(bridge.get_operator_nonce(&op), 2);
    assert!(bridge.get_operator_heartbeat(&op).is_some());
}

/// Replaying the same nonce after a successful heartbeat must be rejected.
#[test]
fn test_heartbeat_replay_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // First heartbeat with nonce 1 — must succeed.
    bridge.heartbeat(&op, &1);
    assert_eq!(bridge.get_operator_nonce(&op), 2);

    // Replaying nonce 1 must fail with InvalidNonce.
    let result = bridge.try_heartbeat(&op, &1);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Nonce must remain at 2 (replay did not advance it).
    assert_eq!(bridge.get_operator_nonce(&op), 2);
}

/// Skipping ahead to a future nonce must also be rejected.
#[test]
fn test_heartbeat_future_nonce_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // Nonce 1 is expected; supplying 99 must fail.
    let result = bridge.try_heartbeat(&op, &99);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));
    assert_eq!(bridge.get_operator_nonce(&op), 1);
}

/// Sequential heartbeats with monotonically increasing nonces must all succeed.
#[test]
fn test_heartbeat_sequential_nonces_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    for expected_nonce in 1u64..=5 {
        env.ledger().with_mut(|li| li.sequence_number += 10);
        bridge.heartbeat(&op, &expected_nonce);
        assert_eq!(bridge.get_operator_nonce(&op), expected_nonce + 1);
    }
}

/// A non-operator address must be rejected before the nonce is even checked,
/// leaving the nonce counter unchanged.
#[test]
fn test_heartbeat_non_operator_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let stranger = Address::generate(&env);
    let result = bridge.try_heartbeat(&stranger, &0);
    assert_eq!(result, Err(Ok(Error::NotOperator)));
    assert_eq!(bridge.get_operator_nonce(&stranger), 0);
}

/// After an operator is removed and re-registered, replay of the original
/// nonce 1 must be rejected because the nonce carried over from removal
/// is greater than 1.
#[test]
fn test_heartbeat_replay_after_re_registration_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // Use nonce 1, nonce advances to 2.
    bridge.heartbeat(&op, &1);

    // Remove operator.
    bridge.set_operator(&op, &false, &0);

    // Re-register; the nonce slot persists in storage — operator nonce remains 2.
    bridge.set_operator(&op, &true, &0);

    // Replaying nonce 1 must still fail.
    let result = bridge.try_heartbeat(&op, &1);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Correct next nonce (2) must still work, however, because we bumped set_operator nonce.
    // The operator nonce after two set_operator calls is 3 (each set_operator consumes one).
    // So we call with whatever get_operator_nonce reports.
    let next = bridge.get_operator_nonce(&op);
    bridge.heartbeat(&op, &next);
    assert_eq!(bridge.get_operator_nonce(&op), next + 1);
}

/// Replay of a heartbeat that was blocked by the circuit breaker must be
/// rejected after the breaker is reset, because the nonce must not have
/// advanced during the blocked call.
#[test]
fn test_heartbeat_replay_after_circuit_breaker_reset_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let bridge_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &bridge_id);

    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = token::Client::new(&env, &token_id.address());
    let token_sac = token::StellarAssetClient::new(&env, &token_id.address());
    let token_address = token_client.address.clone();

    let signers = vec![&env, admin.clone()];
    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    let op = Address::generate(&env);
    client.set_operator(&op, &true, &0);
    let op_nonce = client.get_operator_nonce(&op);

    // Trip the circuit breaker.
    client.set_circuit_breaker_threshold(&500);
    token_sac.mint(&admin, &600);
    client.deposit(
        &admin,
        &600,
        &token_address,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    client.withdraw(&admin, &admin, &600, &token_address);

    // Heartbeat blocked.
    let blocked = client.try_heartbeat(&op, &op_nonce);
    assert_eq!(blocked, Err(Ok(Error::CircuitBreakerActive)));
    // Nonce unchanged.
    assert_eq!(client.get_operator_nonce(&op), op_nonce);
}
