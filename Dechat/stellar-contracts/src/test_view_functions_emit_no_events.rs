//! Tests for Issue #1427: read-only getters must not publish events.
//!
//! `is_operator`, `is_denied`, `get_accrued_fees`, and `get_receipt_by_index`
//! used to each emit a bespoke "checked" event on every call, including
//! calls made only to simulate a transaction or render UI state. Those
//! events duplicated invocation data indexers already see and cost a
//! `Symbol::new` allocation plus an event publish on every read. State
//! transitions remain fully audited via their own dedicated events
//! (`DenyAddressEvent`, `SetOperatorEvent`, `FeeWithdrawnEvent`,
//! `FeeVaultReconciledEvent`, deposit/receipt events, etc.) — only the
//! simulation-only reads lost their event.

use crate::{DataKey, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, Env,
};

fn setup(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'_>,
    Address,
    Address,
    TokenClient<'_>,
) {
    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token = TokenClient::new(env, &token_addr);

    let signers = vec![env, admin.clone()];
    client.init(
        &admin,
        &token_addr,
        &10_000_000i128,
        &1i128,
        &signers,
        &1,
        &0,
    );

    (contract_id, client, admin, token_addr, token)
}

/// The event buffer in the test environment holds only the most recent
/// top-level contract invocation, so a call that emits nothing leaves it
/// empty regardless of what earlier calls emitted.
fn event_count(env: &Env, contract_id: &Address) -> usize {
    env.events()
        .all()
        .filter_by_contract(contract_id)
        .events()
        .len()
}

#[test]
fn is_operator_emits_no_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _admin, _token_addr, _token) = setup(&env);
    let operator = Address::generate(&env);
    client.set_operator(&operator, &true, &0);

    assert!(client.is_operator(&operator));
    assert_eq!(event_count(&env, &contract_id), 0);

    assert!(!client.is_operator(&Address::generate(&env)));
    assert_eq!(event_count(&env, &contract_id), 0);
}

#[test]
fn get_accrued_fees_emits_no_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _admin, token_addr, _token) = setup(&env);

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &500i128);
    });

    assert_eq!(client.get_accrued_fees(&token_addr), 500);
    assert_eq!(event_count(&env, &contract_id), 0);

    // Also true for an unregistered token, which short-circuits to 0.
    let other_token = Address::generate(&env);
    assert_eq!(client.get_accrued_fees(&other_token), 0);
    assert_eq!(event_count(&env, &contract_id), 0);
}

#[test]
fn get_receipt_by_index_emits_no_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, _admin, token_addr, _token) = setup(&env);

    let depositor = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&depositor, &1_000_000i128);
    client.deposit(
        &depositor,
        &1_000_000i128,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    // In-bounds read.
    assert!(client.get_receipt_by_index(&0u64).is_some());
    assert_eq!(event_count(&env, &contract_id), 0);

    // Out-of-bounds read used to trip a `ReceiptOobEvent` "circuit breaker";
    // it must now just return None.
    assert!(client.get_receipt_by_index(&999u64).is_none());
    assert_eq!(event_count(&env, &contract_id), 0);
}
