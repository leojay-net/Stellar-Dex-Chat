//! Tests for issue #970 — 48-hour admin transfer timelock.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

use crate::{Error, FiatBridge, FiatBridgeClient, MIN_TIMELOCK_DELAY};

fn env_with_sequence(seq: u32) -> Env {
    let env = Env::default();
    env.ledger().with_mut(|l| l.sequence_number = seq);
    env
}

fn init_client(env: &Env, client: &FiatBridgeClient, admin: &Address, token: &Address) {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    client.init(admin, token, &1_000_000, &100, &signers, &1);
}

/// `accept_admin` must fail with AdminTransferTooEarly if called before the delay.
#[test]
fn accept_admin_before_delay_returns_too_early() {
    let env = env_with_sequence(1000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    init_client(&env, &client, &admin, &token);
    client.transfer_admin(&new_admin);

    // Advance ledger by less than MIN_TIMELOCK_DELAY.
    env.ledger().with_mut(|l| {
        l.sequence_number = 1000 + MIN_TIMELOCK_DELAY - 1;
    });

    let result = client.try_accept_admin();
    assert_eq!(result, Err(Ok(Error::AdminTransferTooEarly)));
}

/// `accept_admin` must succeed exactly at the delay boundary.
#[test]
fn accept_admin_at_delay_boundary_succeeds() {
    let env = env_with_sequence(1000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    init_client(&env, &client, &admin, &token);
    client.transfer_admin(&new_admin);

    // Advance ledger to exactly the unlock boundary.
    env.ledger().with_mut(|l| {
        l.sequence_number = 1000 + MIN_TIMELOCK_DELAY;
    });

    client.accept_admin();
    assert_eq!(client.get_admin(), new_admin);
}

/// Original admin can cancel the pending transfer within the waiting period.
#[test]
fn cancel_admin_transfer_removes_pending() {
    let env = env_with_sequence(1000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    init_client(&env, &client, &admin, &token);
    client.transfer_admin(&new_admin);
    client.cancel_admin_transfer();

    // After cancellation, accept_admin should return NoPendingAdmin.
    env.ledger().with_mut(|l| {
        l.sequence_number = 1000 + MIN_TIMELOCK_DELAY;
    });

    let result = client.try_accept_admin();
    assert_eq!(result, Err(Ok(Error::NoPendingAdmin)));
}

/// Cancelling when no transfer is pending returns NoPendingAdmin.
#[test]
fn cancel_when_no_pending_returns_error() {
    let env = env_with_sequence(1000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    init_client(&env, &client, &admin, &token);

    let result = client.try_cancel_admin_transfer();
    assert_eq!(result, Err(Ok(Error::NoPendingAdmin)));
}

/// ConfigSnapshot exposes the proposal ledger so clients can compute the unlock time.
#[test]
fn config_snapshot_includes_proposed_at() {
    let env = env_with_sequence(5000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    init_client(&env, &client, &admin, &token);
    client.transfer_admin(&new_admin);

    let snapshot = client.get_config_snapshot();
    assert_eq!(snapshot.pending_admin, Some(new_admin));
    assert_eq!(snapshot.pending_admin_proposed_at, Some(5000u32));
}
