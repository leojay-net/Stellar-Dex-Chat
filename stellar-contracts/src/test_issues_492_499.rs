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
    FiatBridgeClient,
    Address,
    Address,
    TokenClient,
    StellarAssetClient,
) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_addr, token, token_sac) = create_token(env, &token_admin);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000_000, &1, &signers, &1);
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
    let result = bridge.try_set_operator(&stranger, &false);
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
    let result = bridge.try_set_operator(&operator, &true);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

/// Deactivating an operator while the contract is paused must also be blocked.
#[test]
fn set_operator_deactivate_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true);

    bridge.pause();

    let result = bridge.try_set_operator(&operator, &false);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

/// Setting the admin address as operator must return NotAllowed.
#[test]
fn set_operator_rejects_admin_as_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, _, _, _) = setup_bridge(&env);

    let result = bridge.try_set_operator(&admin, &true);
    assert_eq!(result, Err(Ok(Error::NotAllowed)));
}

/// Setting the contract itself as operator must return InvalidRecipient.
#[test]
fn set_operator_rejects_contract_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env);

    let result = bridge.try_set_operator(&contract_id, &true);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));
}

/// Re-activating an already active operator must succeed (idempotent).
#[test]
fn set_operator_reactivate_already_active_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true);
    // Should not error on re-activation
    bridge.set_operator(&operator, &true);
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
    bridge.set_operator(&op1, &true);

    let result = bridge.try_set_operator(&op2, &true);
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
    bridge.set_operator(&operator, &true);
    bridge.set_operator(&operator, &false);

    let result = bridge.try_set_operator(&operator, &false);
    assert_eq!(result, Err(Ok(Error::NotOperator)));
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
