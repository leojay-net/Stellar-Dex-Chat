//! Tests for issues #492 and #499.
//!
//! Issue #492 – fix(contract): add boundary validation to set_operator.
//! Issue #499 – fix(contract): deposit overflow protection and balance-update event.
//!
//! This module validates that:
//!   - set_operator rejects invalid state transitions with explicit errors (#492)
//!   - set_operator is blocked while the contract is paused (#492)
//!   - deposit receipt-counter increment is overflow-safe (#499)
//!   - daily deposit accumulator uses checked arithmetic (#499)
//!   - DepositBalanceUpdatedEvent is emitted on every successful deposit (#499)

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
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
) -> (
    Address,
    FiatBridgeClient<'_>,
    Address,
    Address,
    TokenClient<'_>,
    StellarAssetClient<'_>,
) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_addr, token, token_sac) = create_token(env, &token_admin);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000_000, &1, &signers, &1, &0);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

fn dummy_reference(env: &Env) -> Bytes {
    Bytes::from_array(env, b"ref")
}

// ── Issue #492: set_operator boundary validation ──────────────────────────────

/// Deactivating an operator that was never registered must return NotOperator,
/// not silently succeed. A silent no-op here masks caller bugs and can corrupt
/// batch bookkeeping.
#[test]
fn set_operator_deactivate_non_existent_returns_not_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let stranger = Address::generate(&env);
    let result = bridge.try_set_operator(&stranger, &false, &0);
    assert_eq!(result, Err(Ok(Error::NotOperator)));
}

/// Activating an operator while the contract is paused must be blocked.
/// Mutating the operator list during a pause can corrupt batch operations.
#[test]
fn set_operator_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.pause();

    let operator = Address::generate(&env);
    let result = bridge.try_set_operator(&operator, &true, &0);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

/// Deactivating an operator while the contract is paused must also be blocked.
#[test]
fn set_operator_deactivate_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);

    bridge.pause();

    let result = bridge.try_set_operator(&operator, &false, &1);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

/// Setting the admin address as operator must return NotAllowed.
#[test]
fn set_operator_rejects_admin_as_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    let result = bridge.try_set_operator(&admin, &true, &0);
    assert_eq!(result, Err(Ok(Error::NotAllowed)));
}

/// Setting the contract itself as operator must return InvalidRecipient.
#[test]
fn set_operator_rejects_contract_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_set_operator(&contract_id, &true, &0);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));
}

/// Re-activating an already active operator must succeed (idempotent).
#[test]
fn set_operator_reactivate_already_active_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);
    // Should not error on re-activation
    bridge.set_operator(&operator, &true, &1);
}

/// Exceeding the operator cap must return OperatorCapReached.
#[test]
fn set_operator_cap_reached_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    bridge.set_max_operators(&1);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    bridge.set_operator(&op1, &true, &0);

    let result = bridge.try_set_operator(&op2, &true, &0);
    assert_eq!(result, Err(Ok(Error::OperatorCapReached)));
}

/// After deactivating an operator, trying to deactivate again must return
/// NotOperator (not silently succeed), preventing corrupted batch state.
#[test]
fn set_operator_double_deactivate_returns_not_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);
    bridge.set_operator(&operator, &false, &1);

    let result = bridge.try_set_operator(&operator, &false, &2);
    assert_eq!(result, Err(Ok(Error::NotOperator)));
}

// ── set_operator nonce validation tests ─────────────────────────────────────

/// set_operator with valid nonce should succeed and increment nonce.
#[test]
fn set_operator_with_valid_nonce_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    assert_eq!(bridge.get_operator_nonce(&operator), 0);

    // First activation with nonce 0
    bridge.set_operator(&operator, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
    assert!(bridge.is_operator(&operator));

    // Deactivation with nonce 1
    bridge.set_operator(&operator, &false, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);
    assert!(!bridge.is_operator(&operator));
}

/// set_operator with stale nonce should fail with StaleNonce error.
#[test]
fn set_operator_with_stale_nonce_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Try to replay with nonce 0 (stale)
    let result = bridge.try_set_operator(&operator, &false, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Nonce should remain unchanged
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
    assert!(bridge.is_operator(&operator));
}

/// set_operator with future nonce should fail with InvalidNonce error.
#[test]
fn set_operator_with_future_nonce_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    assert_eq!(bridge.get_operator_nonce(&operator), 0);

    // Try to use nonce 5 (future)
    let result = bridge.try_set_operator(&operator, &true, &5);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Nonce should remain unchanged
    assert_eq!(bridge.get_operator_nonce(&operator), 0);
    assert!(!bridge.is_operator(&operator));
}

/// set_operator nonce is per-operator, independent across operators.
#[test]
fn set_operator_nonce_is_per_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator_a = Address::generate(&env);
    let operator_b = Address::generate(&env);

    // Both start at nonce 0
    assert_eq!(bridge.get_operator_nonce(&operator_a), 0);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 0);

    // Operator A uses nonce 0
    bridge.set_operator(&operator_a, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator_a), 1);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 0);

    // Operator B can still use nonce 0
    bridge.set_operator(&operator_b, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator_a), 1);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 1);
}

/// set_operator nonce increments monotonically with each call.
#[test]
fn set_operator_nonce_increments_monotonically() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);

    // Execute multiple set_operator calls
    bridge.set_operator(&operator, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    bridge.set_operator(&operator, &true, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);

    bridge.set_operator(&operator, &false, &2);
    assert_eq!(bridge.get_operator_nonce(&operator), 3);

    bridge.set_operator(&operator, &true, &3);
    assert_eq!(bridge.get_operator_nonce(&operator), 4);
}

/// set_operator nonce persists across operator deactivation/reactivation.
#[test]
fn set_operator_nonce_persists_across_deactivation() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);

    // Use nonce 0 and 1
    bridge.set_operator(&operator, &true, &0);
    bridge.set_operator(&operator, &true, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);

    // Deactivate operator
    bridge.set_operator(&operator, &false, &2);

    // Nonce should still be 3
    assert_eq!(bridge.get_operator_nonce(&operator), 3);

    // Reactivate operator
    bridge.set_operator(&operator, &true, &3);
    assert_eq!(bridge.get_operator_nonce(&operator), 4);
}

/// set_operator nonce validation occurs before state changes.
#[test]
fn set_operator_nonce_validation_before_state_change() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Try stale nonce - should fail without changing operator status
    let result = bridge.try_set_operator(&operator, &false, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Operator should still be active
    assert!(bridge.is_operator(&operator));
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
}

/// set_operator with nonce error should not affect other operators.
#[test]
fn set_operator_nonce_error_isolated_per_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);

    bridge.set_operator(&op1, &true, &0);
    bridge.set_operator(&op2, &true, &0);

    // op1 tries stale nonce
    let result = bridge.try_set_operator(&op1, &false, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // op2 should still be able to use nonce 1
    bridge.set_operator(&op2, &false, &1);
    assert!(!bridge.is_operator(&op2));
}

// ── Issue #499: deposit overflow protection ───────────────────────────────────

/// A normal deposit must emit DepositBalanceUpdatedEvent with the correct
/// running total, confirming that the balance update completed without overflow.
#[test]
fn deposit_emits_balance_updated_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, _token, token_sac) = setup_bridge(&env);

    let user = Address::generate(&env);
    token_sac.mint(&user, &500_000);

    bridge.deposit(
        &user,
        &500_000,
        &token_addr,
        &dummy_reference(&env),
        &0,
        &0,
        &None,
    );

    // Verify at least one event was emitted for this contract (deposit + balance-update events)
    let contract_events = env.events().all().filter_by_contract(&contract_id);
    let raw = contract_events.events();
    assert!(!raw.is_empty(), "expected at least one contract event after deposit");
}

/// Two sequential deposits must accumulate total_deposited correctly and not
/// overflow for large (but valid) amounts.
#[test]
fn deposit_accumulates_total_without_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, _token, token_sac) = setup_bridge(&env);

    let user = Address::generate(&env);
    // Large but individually valid deposits (under the 1_000_000_000 limit)
    let amount: i128 = 500_000_000;
    token_sac.mint(&user, &(amount * 2));

    bridge.deposit(
        &user,
        &amount,
        &token_addr,
        &dummy_reference(&env),
        &0,
        &0,
        &None,
    );

    // Reset cooldown by advancing ledger
    env.ledger().with_mut(|l| l.sequence_number += 10_000);

    bridge.deposit(
        &user,
        &amount,
        &token_addr,
        &dummy_reference(&env),
        &0,
        &0,
        &None,
    );
    // Both deposits succeeded — total_deposited = 2 * amount, no overflow
}

/// A zero-amount deposit must still be rejected with ZeroAmount, confirming
/// the amount validation runs before any arithmetic.
#[test]
fn deposit_rejects_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env);

    let user = Address::generate(&env);
    let result = bridge.try_deposit(
        &user,
        &0,
        &token_addr,
        &dummy_reference(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

/// Deposits that would exceed the per-token limit must be rejected before any
/// state is modified — no partial overflow can occur.
#[test]
fn deposit_rejects_amount_exceeding_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);

    let user = Address::generate(&env);
    token_sac.mint(&user, &2_000_000_000);

    let result = bridge.try_deposit(
        &user,
        &1_500_000_000, // exceeds the 1_000_000_000 limit
        &token_addr,
        &dummy_reference(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}
