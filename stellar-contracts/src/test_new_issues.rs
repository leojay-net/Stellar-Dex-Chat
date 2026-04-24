//! Tests for issues #659 and #668.
//!
//! Issue #659 – docs: improve inline documentation for overflow prevention.
//! Issue #668 – fix(contract): correct edge case validation in upgrade.
//!
//! This module validates the boundary checks and overflow-prevention logic
//! added to the governed upgrade mechanism (`propose_upgrade` /
//! `execute_upgrade` / `cancel_upgrade`).

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env,
};

// ── helpers ──────────────────────────────────────────────────────────────

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

/// Initialise a bridge contract and return the key handles.
fn setup_bridge(
    env: &Env,
) -> (
    Address,            // contract_id
    FiatBridgeClient,   // bridge client
    Address,            // admin
    Address,            // token_addr
    TokenClient,        // token client
    StellarAssetClient, // token SAC client
) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_addr, token, token_sac) = create_token(env, &token_admin);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

/// Return a dummy 32-byte WASM hash (all 0xAB bytes).
fn dummy_wasm_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xABu8; 32])
}

// ── Issue #668: propose_upgrade boundary checks ───────────────────────────

/// A delay of zero must be rejected — it would allow an immediate upgrade,
/// defeating the timelock entirely.
#[test]
fn propose_upgrade_rejects_zero_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_propose_upgrade(&dummy_wasm_hash(&env), &0);
    assert_eq!(result, Err(Ok(Error::UpgradeDelayTooShort)));
}

/// A delay below MIN_UPGRADE_DELAY must be rejected.
#[test]
fn propose_upgrade_rejects_delay_below_minimum() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let too_short = MIN_UPGRADE_DELAY - 1;
    let result = bridge.try_propose_upgrade(&dummy_wasm_hash(&env), &too_short);
    assert_eq!(result, Err(Ok(Error::UpgradeDelayTooShort)));
}

/// A delay exactly equal to MIN_UPGRADE_DELAY must be accepted.
#[test]
fn propose_upgrade_accepts_minimum_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);

    let proposal = bridge
        .get_upgrade_proposal()
        .expect("proposal should exist");
    assert_eq!(
        proposal.executable_after,
        env.ledger().sequence() + MIN_UPGRADE_DELAY
    );
}

/// A delay larger than MIN_UPGRADE_DELAY must also be accepted.
#[test]
fn propose_upgrade_accepts_large_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let large_delay = MIN_UPGRADE_DELAY * 10;
    bridge.propose_upgrade(&dummy_wasm_hash(&env), &large_delay);

    let proposal = bridge
        .get_upgrade_proposal()
        .expect("proposal should exist");
    assert_eq!(
        proposal.executable_after,
        env.ledger().sequence() + large_delay
    );
}

/// Overflow prevention: a delay so large that `current_ledger + delay`
/// would overflow `u32` must return `Error::Overflow` rather than silently
/// wrapping to a value in the past (which would allow an immediate upgrade).
#[test]
fn propose_upgrade_overflow_prevention() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    // Set the ledger sequence close to u32::MAX so that adding any
    // meaningful delay overflows.
    env.ledger()
        .set_sequence_number(u32::MAX - MIN_UPGRADE_DELAY + 1);

    // A delay of MIN_UPGRADE_DELAY would push executable_after past u32::MAX.
    let result = bridge.try_propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);
    assert_eq!(result, Err(Ok(Error::Overflow)));
}

// ── Issue #668: execute_upgrade boundary checks ───────────────────────────

/// Executing an upgrade when no proposal exists must return
/// `Error::UpgradeProposalMissing`.
#[test]
fn execute_upgrade_no_proposal_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
}

/// Executing an upgrade before the timelock has elapsed must return
/// `Error::UpgradeNotReady`.
#[test]
fn execute_upgrade_before_timelock_returns_not_ready() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);

    // Advance ledger by less than the required delay — still locked.
    let current = env.ledger().sequence();
    env.ledger()
        .set_sequence_number(current + MIN_UPGRADE_DELAY - 1);

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeNotReady)));
}

/// Executing an upgrade exactly at `executable_after` must still return
/// `Error::UpgradeNotReady` — the check is strict `>`, not `>=`.
#[test]
fn execute_upgrade_at_exact_boundary_returns_not_ready() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let start = env.ledger().sequence();
    bridge.propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);

    // Set ledger to exactly executable_after — should still be locked.
    env.ledger().set_sequence_number(start + MIN_UPGRADE_DELAY);

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeNotReady)));
}

// ── Issue #668: cancel_upgrade boundary checks ────────────────────────────

/// Cancelling when no proposal exists must return
/// `Error::UpgradeProposalMissing`.
#[test]
fn cancel_upgrade_no_proposal_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_cancel_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
}

/// After cancellation the proposal must no longer be retrievable.
#[test]
fn cancel_upgrade_removes_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);
    assert!(bridge.get_upgrade_proposal().is_some());

    bridge.cancel_upgrade();
    assert!(bridge.get_upgrade_proposal().is_none());
}

/// After cancellation a second cancel must return
/// `Error::UpgradeProposalMissing` (idempotency guard).
#[test]
fn cancel_upgrade_twice_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);
    bridge.cancel_upgrade();

    let result = bridge.try_cancel_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
}

// ── Issue #668: propose_upgrade while paused ─────────────────────────────

/// Proposing an upgrade while the contract is paused must be rejected.
#[test]
fn propose_upgrade_while_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.pause();

    let result = bridge.try_propose_upgrade(&dummy_wasm_hash(&env), &MIN_UPGRADE_DELAY);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

// ── Issue #668: set_upgrade_delay ────────────────────────────────────────

/// The default upgrade delay must equal MIN_UPGRADE_DELAY.
#[test]
fn get_upgrade_delay_returns_default() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    assert_eq!(bridge.get_upgrade_delay(), MIN_UPGRADE_DELAY);
}

/// After calling set_upgrade_delay the new value must be returned.
#[test]
fn set_upgrade_delay_persists() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let new_delay = MIN_UPGRADE_DELAY * 5;
    bridge.set_upgrade_delay(&new_delay);
    assert_eq!(bridge.get_upgrade_delay(), new_delay);
}

// ── Issue #659: math overflow documentation tests ────────────────────────
//
// These tests exercise the boundary conditions documented in math.rs to
// confirm that the overflow-prevention commentary is accurate.

#[test]
fn math_mul_div_floor_exact() {
    // 6 * 2 / 3 = 4 exactly
    assert_eq!(crate::math::mul_div_floor(6, 2, 3), 4);
}

#[test]
fn math_mul_div_floor_rounds_down() {
    // 7 * 3 / 2 = 10.5 → 10
    assert_eq!(crate::math::mul_div_floor(7, 3, 2), 10);
}

#[test]
fn math_mul_div_floor_negative_floor() {
    // -7 * 3 / 2 = -10.5 → floor → -11
    assert_eq!(crate::math::mul_div_floor(-7, 3, 2), -11);
}

#[test]
fn math_mul_div_ceil_rounds_up() {
    // 7 * 3 / 2 = 10.5 → ceil → 11
    assert_eq!(crate::math::mul_div_ceil(7, 3, 2), 11);
}

#[test]
fn math_scale_floor_three_quarters() {
    // 1000 * 3/4 = 750
    assert_eq!(crate::math::scale_floor(1000, 3, 4), 750);
}

#[test]
fn math_scale_floor_rounds_down() {
    // 1001 * 3/4 = 750.75 → 750
    assert_eq!(crate::math::scale_floor(1001, 3, 4), 750);
}
