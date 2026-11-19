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

/// A fresh operator's first heartbeat (nonce == 0) must succeed. Heartbeat
/// nonces are keyed per operator and are unaffected by `set_operator`, which
/// uses its own admin-keyed nonce.
#[test]
fn test_heartbeat_first_call_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&op), 0);

    bridge.heartbeat(&op, &0);
    assert_eq!(bridge.get_operator_nonce(&op), 1);
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

    // First heartbeat with nonce 0 — must succeed.
    bridge.heartbeat(&op, &0);
    assert_eq!(bridge.get_operator_nonce(&op), 1);

    // Replaying nonce 0 is an already-used nonce and must fail with StaleNonce.
    let result = bridge.try_heartbeat(&op, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Nonce must remain at 1 (replay did not advance it).
    assert_eq!(bridge.get_operator_nonce(&op), 1);
}

/// Skipping ahead to a future nonce must also be rejected.
#[test]
fn test_heartbeat_future_nonce_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // Nonce 0 is expected; supplying 99 must fail.
    let result = bridge.try_heartbeat(&op, &99);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));
    assert_eq!(bridge.get_operator_nonce(&op), 0);
}

/// Sequential heartbeats with monotonically increasing nonces must all succeed.
#[test]
fn test_heartbeat_sequential_nonces_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    for expected_nonce in 0u64..5 {
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

/// After an operator is removed and re-registered, replay of an already-used
/// heartbeat nonce must still be rejected because the operator's heartbeat
/// nonce persists across deactivation.
#[test]
fn test_heartbeat_replay_after_re_registration_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin) = setup(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // Use nonce 0, nonce advances to 1.
    bridge.heartbeat(&op, &0);

    // Remove operator (admin-keyed set_operator nonce is now 1).
    bridge.set_operator(&op, &false, &1);

    // Re-register; the heartbeat nonce persists in storage and remains 1.
    bridge.set_operator(&op, &true, &2);
    assert_eq!(bridge.get_operator_nonce(&op), 1);

    // Replaying nonce 0 must still fail.
    let result = bridge.try_heartbeat(&op, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // The next nonce (1) works.
    bridge.heartbeat(&op, &1);
    assert_eq!(bridge.get_operator_nonce(&op), 2);
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
