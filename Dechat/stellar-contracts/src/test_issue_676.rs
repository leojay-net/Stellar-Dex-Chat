//! Invariant tests for `get_accrued_fees` (Issue #676).
//!
//! These tests verify properties that must always hold for the fee vault
//! view function, covering initial state, accrual, withdrawal, isolation,
//! purity, reconciliation, and batch operations.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

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
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1, &0);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

/// Invariant: `get_accrued_fees` returns 0 for any token before any fees are accrued.
#[test]
fn test_get_accrued_fees_invariant_zero_initially() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env);

    // A known token that was registered in setup
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);

    // An entirely unknown (unregistered) token
    let unknown = Address::generate(&env);
    assert_eq!(bridge.get_accrued_fees(&unknown), 0);
}

/// Invariant: after each `accrue_fee`, `get_accrued_fees` returns the exact
/// cumulative sum of all accrued amounts for that token.
#[test]
fn test_get_accrued_fees_invariant_cumulative_on_accrue() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    token_sac.mint(&contract_id, &10_000);

    bridge.accrue_fee(&token_addr, &1_000);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 1_000);

    bridge.accrue_fee(&token_addr, &2_500);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 3_500);

    bridge.accrue_fee(&token_addr, &500);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 4_000);
}

/// Invariant: after each `withdraw_fees`, `get_accrued_fees` decreases by
/// exactly the withdrawn amount and never goes negative.
#[test]
fn test_get_accrued_fees_invariant_decreases_on_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &10_000);
    bridge.accrue_fee(&token_addr, &10_000);

    bridge.withdraw_fees(&Some(recipient.clone()), &token_addr, &3_000, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 7_000);

    bridge.withdraw_fees(&Some(recipient.clone()), &token_addr, &4_000, &1);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 3_000);

    bridge.withdraw_fees(&Some(recipient.clone()), &token_addr, &3_000, &2);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}

/// Invariant: `get_accrued_fees` always returns a non-negative value.
/// Even after the vault reaches zero, a withdrawal attempt must fail
/// without pushing the vault below zero.
#[test]
fn test_get_accrued_fees_invariant_never_negative() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_addr, &1_000);
    bridge.withdraw_fees(&Some(recipient.clone()), &token_addr, &1_000, &0);

    // Vault is now zero
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);

    // Attempting to withdraw from an empty vault must fail
    let result = bridge.try_withdraw_fees(&Some(recipient.clone()), &token_addr, &1, &1);
    assert_eq!(result, Err(Ok(Error::NoFeesToWithdraw)));

    // Vault must still be zero (not negative)
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}

/// Invariant: fee vaults for different tokens are completely isolated.
/// Accruing fees for token A must not affect the vault of token B.
#[test]
fn test_get_accrued_fees_invariant_per_token_isolation() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_a, _, token_sac) = setup_bridge(&env);
    let (token_b, _, token_sac_b) = create_token(&env, &admin);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &5_000);
    token_sac_b.mint(&contract_id, &3_000);

    // Accrue only for token A
    bridge.accrue_fee(&token_a, &5_000);
    assert_eq!(bridge.get_accrued_fees(&token_a), 5_000);
    assert_eq!(bridge.get_accrued_fees(&token_b), 0);

    // Accrue only for token B
    bridge.accrue_fee(&token_b, &3_000);
    assert_eq!(bridge.get_accrued_fees(&token_a), 5_000);
    assert_eq!(bridge.get_accrued_fees(&token_b), 3_000);

    // Withdraw from token A only
    bridge.withdraw_fees(&Some(recipient.clone()), &token_a, &2_000, &0);
    assert_eq!(bridge.get_accrued_fees(&token_a), 3_000);
    assert_eq!(bridge.get_accrued_fees(&token_b), 3_000);
}

/// Invariant: calling `get_accrued_fees` must not mutate any storage.
/// A read-only view function must be side-effect free (except event emission).
#[test]
fn test_get_accrued_fees_invariant_purity_no_state_mutation() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    token_sac.mint(&contract_id, &5_000);

    bridge.accrue_fee(&token_addr, &5_000);

    // Capture storage snapshot before repeated reads
    let vault_before = bridge.get_accrued_fees(&token_addr);

    // Repeated reads must return the same value
    for _ in 0..10 {
        assert_eq!(bridge.get_accrued_fees(&token_addr), vault_before);
    }

    // Verify FeeQueryEvent is emitted with correct version
    let event_count_before: usize = {
        // Events emitted up to the first read: accrue_fee emitted FeeAccruedEvent
        // get_accrued_fees emits FeeQueryEvent
        let initial = env.events().all();
        initial.filter_by_contract(&contract_id).events().len()
    };

    // Read again — FeeQueryEvent should be emitted
    bridge.get_accrued_fees(&token_addr);
    let final_events = env.events().all();
    let final_filtered = final_events.filter_by_contract(&contract_id);
    assert_eq!(
        final_filtered.events().len(),
        event_count_before + 1,
        "get_accrued_fees must emit exactly one FeeQueryEvent"
    );
}

/// Invariant: after reconciliation (triggered by `withdraw_fees`), the vault
/// balance reported by `get_accrued_fees` must not exceed the contract's
/// on-chain token balance.
#[test]
fn test_get_accrued_fees_invariant_reconciled_vault_bound() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    // Set vault higher than the actual on-chain balance
    token_sac.mint(&contract_id, &200);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &500i128);
    });

    assert_eq!(bridge.get_accrued_fees(&token_addr), 500);

    // withdraw_fees triggers reconciliation
    bridge.withdraw_fees(&Some(recipient.clone()), &token_addr, &100, &0);

    // After reconciliation + partial withdrawal, vault <= contract balance
    let contract_balance = token.balance(&contract_id);
    assert!(
        bridge.get_accrued_fees(&token_addr) <= contract_balance,
        "vault must not exceed contract balance after reconciliation"
    );
}

/// Invariant: `withdraw_fees_batch` zeros out the vault for every
/// token in the provided list.
#[test]
fn test_get_accrued_fees_invariant_batch_sweep_zeros_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_a, _, token_sac) = setup_bridge(&env);
    let (token_b, _, token_sac_b) = create_token(&env, &admin);
    let (token_c, _, token_sac_c) = create_token(&env, &admin);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &3_000);
    token_sac_b.mint(&contract_id, &2_000);
    token_sac_c.mint(&contract_id, &1_000);

    bridge.accrue_fee(&token_a, &3_000);
    bridge.accrue_fee(&token_b, &2_000);
    bridge.accrue_fee(&token_c, &1_000);

    let tokens = vec![&env, token_a.clone(), token_b.clone(), token_c.clone()];
    bridge.withdraw_fees_batch(&recipient, &tokens);

    assert_eq!(bridge.get_accrued_fees(&token_a), 0);
    assert_eq!(bridge.get_accrued_fees(&token_b), 0);
    assert_eq!(bridge.get_accrued_fees(&token_c), 0);
}

/// Invariant: `accrue_fee` with a non-positive amount is rejected and
/// must not change the vault balance.
#[test]
fn test_get_accrued_fees_invariant_zero_amount_accrue_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env);

    let zero_result = bridge.try_accrue_fee(&token_addr, &0);
    assert_eq!(zero_result, Err(Ok(Error::ZeroAmount)));

    let neg_result = bridge.try_accrue_fee(&token_addr, &-100);
    assert_eq!(neg_result, Err(Ok(Error::ZeroAmount)));

    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}

/// Invariant: `get_accrued_fees` emits FeeQueryEvent with EVENT_VERSION.
#[test]
fn test_get_accrued_fees_emits_query_event_with_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    token_sac.mint(&contract_id, &5_000);

    bridge.accrue_fee(&token_addr, &5_000);

    // Clear previous events
    let _ = env.events().all();

    // Call get_accrued_fees
    let amount = bridge.get_accrued_fees(&token_addr);
    assert_eq!(amount, 5_000);

    // Verify FeeQueryEvent was emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    let event_vec: Vec<_> = events.events().iter().collect();

    assert_eq!(event_vec.len(), 1, "Exactly one event should be emitted");

    // Verify the event has the correct structure
    let event = &event_vec[0];
    let body = match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => v0,
        _ => panic!("Expected V0 event body"),
    };

    // Check that the topic is FeeQueryEvent (struct name becomes topic)
    let topic = body.topic.iter().next().unwrap();
    match topic {
        soroban_sdk::xdr::ScVal::Symbol(sym) => {
            assert_eq!(sym.to_string(), "fee_query_event", "Event topic should be fee_query_event");
        }
        _ => panic!("Expected Symbol topic"),
    }

    // Check that version field in data is EVENT_VERSION
    if let soroban_sdk::xdr::ScVal::Map(Some(map)) = &body.data {
        let version_found = map.iter().any(|entry| {
            if let soroban_sdk::xdr::ScVal::Symbol(key) = &entry.key {
                if key.to_string() == "version" {
                    if let soroban_sdk::xdr::ScVal::U32(val) = entry.val {
                        return *val == EVENT_VERSION;
                    }
                }
            }
            false
        });
        assert!(version_found, "FeeQueryEvent should contain version = EVENT_VERSION");
    } else {
        panic!("Expected Map in event data");
    }
}
