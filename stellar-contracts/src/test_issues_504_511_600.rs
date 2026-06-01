//! Integration tests for issues #504, #511, and #600.
//!
//! Issue #504 – fix(contract): correct edge case validation in heartbeat.
//! Issue #511 – feat(contract): implement circuit breaker for get_receipt_by_index.
//! Issue #600 – feat(contract): implement admin authentication logic for initialize.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, Env,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn create_token<'a>(
    e: &Env,
    admin: &Address,
) -> (Address, TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (
        addr.clone(),
        TokenClient::new(e, &addr),
        StellarAssetClient::new(e, &addr),
    )
}

fn setup_bridge(
    env: &Env,
    limit: i128,
) -> (
    Address,
    FiatBridgeClient,
    Address,
    Address,
    TokenClient,
    StellarAssetClient,
) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_owner = Address::generate(env);
    let (token_addr, token, token_sac) = create_token(env, &token_owner);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &limit, &1, &signers, &1);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

/// Deposits `amount` tokens for `user` and returns the resulting receipt hash.
fn fund_and_deposit(
    env: &Env,
    bridge: &FiatBridgeClient,
    token_sac: &StellarAssetClient,
    user: &Address,
    token_addr: &Address,
    amount: i128,
) -> BytesN<32> {
    token_sac.mint(user, &amount);
    let reference = Bytes::from_slice(env, b"ref");
    bridge.deposit(user, &amount, token_addr, &reference, &0, &0, &None)
}

// ── Issue #504: heartbeat edge case validation ────────────────────────────────

#[test]
fn heartbeat_rejected_when_contract_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _token_addr, _, _) = setup_bridge(&env, 1_000_000);

    // Register an operator and allow one slot
    bridge.set_max_operators(&50);
    bridge.set_operator(&admin, &true);

    // Pause the contract
    bridge.pause();

    // Heartbeat must be rejected when paused
    let result = bridge.try_heartbeat(&admin, &0);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn heartbeat_rejected_when_circuit_breaker_tripped() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000_000);

    // Register operator
    bridge.set_max_operators(&50);
    bridge.set_operator(&admin, &true);

    // Set a low circuit breaker threshold, fund the contract, then trip it
    bridge.set_circuit_breaker_threshold(&100);
    fund_and_deposit(&env, &bridge, &token_sac, &admin, &token_addr, 500);
    // Withdraw just over the threshold to trip the circuit breaker
    bridge.withdraw(&admin, &admin, &101, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Heartbeat must be rejected when circuit breaker is tripped
    let result = bridge.try_heartbeat(&admin, &0);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn heartbeat_rejected_for_non_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, _token_addr, _, _) = setup_bridge(&env, 1_000_000);

    let non_operator = Address::generate(&env);
    let result = bridge.try_heartbeat(&non_operator, &0);
    assert_eq!(result, Err(Ok(Error::NotOperator)));
}

#[test]
fn heartbeat_succeeds_for_valid_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _token_addr, _, _) = setup_bridge(&env, 1_000_000);

    bridge.set_max_operators(&50);
    bridge.set_operator(&admin, &true);

    // Valid heartbeat should succeed
    bridge.heartbeat(&admin, &0);

    let hb = bridge.get_operator_heartbeat(&admin);
    assert!(hb.is_some());
}

#[test]
fn heartbeat_nonce_replay_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _token_addr, _, _) = setup_bridge(&env, 1_000_000);

    bridge.set_max_operators(&50);
    bridge.set_operator(&admin, &true);

    bridge.heartbeat(&admin, &0);

    // Replaying nonce 0 must be rejected
    let result = bridge.try_heartbeat(&admin, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));
}

// ── Issue #511: circuit breaker for get_receipt_by_index ─────────────────────

#[test]
fn get_receipt_by_index_blocked_when_circuit_breaker_tripped() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000_000);

    // Create a deposit so index 0 exists
    fund_and_deposit(&env, &bridge, &token_sac, &admin, &token_addr, 500);

    // Trip the circuit breaker
    bridge.set_circuit_breaker_threshold(&100);
    bridge.withdraw(&admin, &admin, &101, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Access must be blocked
    let result = bridge.try_get_receipt_by_index(&0);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn get_receipt_by_index_returns_receipt_when_circuit_breaker_not_tripped() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000_000);

    let receipt_hash = fund_and_deposit(&env, &bridge, &token_sac, &admin, &token_addr, 500);

    let receipt = bridge.get_receipt_by_index(&0);
    assert!(receipt.is_some());
    assert_eq!(receipt.unwrap().id, receipt_hash);
}

#[test]
fn get_receipt_by_index_returns_none_for_out_of_bounds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000_000);

    fund_and_deposit(&env, &bridge, &token_sac, &admin, &token_addr, 500);

    // Only index 0 exists; index 1 and beyond should return None
    assert_eq!(bridge.get_receipt_by_index(&1), None);
    assert_eq!(bridge.get_receipt_by_index(&999), None);
}

#[test]
fn get_receipt_by_index_accessible_after_circuit_breaker_reset() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000_000);

    let receipt_hash = fund_and_deposit(&env, &bridge, &token_sac, &admin, &token_addr, 500);

    // Trip then reset the circuit breaker
    bridge.set_circuit_breaker_threshold(&100);
    bridge.withdraw(&admin, &admin, &101, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    bridge.reset_circuit_breaker();
    assert!(!bridge.is_circuit_breaker_tripped());

    // After reset, access should be restored
    let receipt = bridge.get_receipt_by_index(&0);
    assert!(receipt.is_some());
    assert_eq!(receipt.unwrap().id, receipt_hash);
}

// ── Issue #600: admin authentication for initialize ───────────────────────────

#[test]
fn init_requires_admin_auth() {
    let env = Env::default();
    // Do NOT mock auths — require_auth fails without proper authorization

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);
    let signers = vec![&env, admin.clone()];

    // Without auth, init must fail
    let result = bridge.try_init(&admin, &token_addr, &1_000_000, &1, &signers, &1);
    assert!(result.is_err());
}

#[test]
fn init_succeeds_with_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);

    assert_eq!(bridge.get_admin(), admin);
}

#[test]
fn init_rejects_duplicate_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);

    // Second call must fail with AlreadyInitialized
    let result = bridge.try_init(&admin, &token_addr, &1_000_000, &1, &signers, &1);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn init_rejects_zero_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);
    let signers = vec![&env, admin.clone()];

    let result = bridge.try_init(&admin, &token_addr, &0, &1, &signers, &1);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn init_rejects_min_deposit_at_or_above_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);
    let signers = vec![&env, admin.clone()];

    // min_deposit == limit must be rejected
    let result = bridge.try_init(&admin, &token_addr, &100, &100, &signers, &1);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));

    // min_deposit > limit must also be rejected (fresh contract for clean state)
    let contract_id2 = env.register(FiatBridge, ());
    let bridge2 = FiatBridgeClient::new(&env, &contract_id2);
    let result2 = bridge2.try_init(&admin, &token_addr, &100, &200, &signers, &1);
    assert_eq!(result2, Err(Ok(Error::BelowMinimum)));
}

#[test]
fn init_rejects_invalid_multisig_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);
    let signers = vec![&env, admin.clone()];

    // threshold 0 must be rejected
    let result = bridge.try_init(&admin, &token_addr, &1_000_000, &1, &signers, &0);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));

    // threshold exceeding signer count must be rejected
    let contract_id2 = env.register(FiatBridge, ());
    let bridge2 = FiatBridgeClient::new(&env, &contract_id2);
    let result2 = bridge2.try_init(&admin, &token_addr, &1_000_000, &1, &signers, &2);
    assert_eq!(result2, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn init_rejects_duplicate_signers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_owner = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_owner);

    // Two identical signers must be rejected
    let dup_signers = vec![&env, admin.clone(), admin.clone()];
    let result = bridge.try_init(&admin, &token_addr, &1_000_000, &1, &dup_signers, &1);
    assert_eq!(result, Err(Ok(Error::DuplicateSigner)));
}
