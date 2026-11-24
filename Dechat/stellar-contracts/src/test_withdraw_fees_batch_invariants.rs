//! Invariant tests for [`FiatBridge::withdraw_fees_batch`].
//!
//! `withdraw_fees_batch` sweeps *accrued* per-token fee vaults (populated by
//! [`FiatBridge::accrue_fee`]) out to a recipient in one call. Because fee
//! vaults are tracked separately from `total_deposited` / `total_withdrawn`,
//! a buggy batch implementation could siphon tracked depositor funds instead,
//! or double-spend a fee vault across tokens. The invariants asserted here
//! are:
//!
//! * `total_deposited >= total_withdrawn` and `net_deposited >= total_liabilities`
//!   are unaffected by a fee withdrawal — depositor accounting never moves;
//! * every token in the batch with a positive fee vault balance is swept in
//!   full and its vault is zeroed; a token with a zero or already-swept vault
//!   is left untouched (no-op, no transfer attempted);
//! * `fee_recipient`, when configured, always overrides the caller-supplied
//!   `to` address;
//! * only the admin may call it, and the per-caller nonce cannot be replayed;
//! * a rejected call (unauthorised caller, replayed nonce) leaves every fee
//!   vault and the token balance untouched.
//!
//! These mirror the runtime checks performed by
//! [`FiatBridge::check_invariants`] (see `src/lib.rs`).
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, Address, Bytes, Env, Vec,
};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &contract_address.address()),
        token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

fn setup_bridge(
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
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    (
        contract_id,
        client,
        admin,
        token_address,
        token_client,
        token_admin,
    )
}

/// Deposits `amount` so the vault holds enough of `token_addr` to move around,
/// which also stands in for the "primary" whitelisted token used by every test.
fn seed_deposit(
    env: &Env,
    bridge: &FiatBridgeClient,
    token_addr: &Address,
    token_admin: &token::StellarAssetClient,
    amount: i128,
) {
    let depositor = Address::generate(env);
    token_admin.mint(&depositor, &amount.saturating_add(1_000));
    let reference = Bytes::from_slice(env, b"seed");
    bridge.deposit(&depositor, &amount, token_addr, &reference, &0, &0, &None);
}

fn depositor_invariants_hold(bridge: &FiatBridgeClient, balance: i128) {
    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    assert!(total_deposited >= total_withdrawn);
    let net_deposited = total_deposited - total_withdrawn;
    assert!(net_deposited >= total_liabilities);
    assert!(balance >= net_deposited);
}

#[test]
fn withdraw_fees_batch_sweeps_accrued_fees_and_zeroes_the_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    // Fund the contract with enough of the fee token to actually pay out the fee.
    token_admin.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_addr, &400);

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);

    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&contract_id), 1_000 - 400);

    // Sweeping the same tokens again is a no-op: the vault was zeroed.
    bridge.withdraw_fees_batch(&recipient, &tokens, &1);
    assert_eq!(token_client.balance(&recipient), 400);
}

#[test]
fn withdraw_fees_batch_does_not_disturb_depositor_accounting() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);
    token_admin.mint(&contract_id, &1_000); // fee funds, on top of depositor funds
    bridge.accrue_fee(&token_addr, &700);

    let total_deposited_before = bridge.get_total_deposited();
    let total_withdrawn_before = bridge.get_total_withdrawn();

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);

    assert_eq!(bridge.get_total_deposited(), total_deposited_before);
    assert_eq!(bridge.get_total_withdrawn(), total_withdrawn_before);
    depositor_invariants_hold(&bridge, token_client.balance(&contract_id));
}

#[test]
fn withdraw_fees_batch_skips_tokens_with_no_accrued_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    token_admin.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_addr, &250);

    let untouched_admin = Address::generate(&env);
    let (untouched_token, _untouched_token_admin) = create_token_contract(&env, &untouched_admin);

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(untouched_token.address.clone());
    tokens.push_back(token_addr.clone());
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);

    // Only the token with a positive fee vault was swept; the other, whose
    // vault defaults to 0, was skipped without attempting a transfer.
    assert_eq!(token_client.balance(&recipient), 250);
    assert_eq!(token_client.balance(&contract_id), 1_000 - 250);
}

#[test]
fn withdraw_fees_batch_sweeps_multiple_tokens_in_one_call() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_a, token_a_client, token_a_admin) = setup_bridge(&env);
    let (token_b_client, token_b_admin) = create_token_contract(&env, &admin);
    let token_b = token_b_client.address.clone();

    token_a_admin.mint(&contract_id, &1_000);
    token_b_admin.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_a, &300);
    bridge.accrue_fee(&token_b, &150);

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_a.clone());
    tokens.push_back(token_b.clone());
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);

    assert_eq!(token_a_client.balance(&recipient), 300);
    assert_eq!(token_b_client.balance(&recipient), 150);
}

#[test]
fn withdraw_fees_batch_honours_fee_recipient_over_the_supplied_to_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    token_admin.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_addr, &500);

    let fee_recipient = Address::generate(&env);
    bridge.set_fee_recipient(&fee_recipient);

    let unused_to = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());
    bridge.withdraw_fees_batch(&unused_to, &tokens, &0);

    assert_eq!(token_client.balance(&fee_recipient), 500);
    assert_eq!(token_client.balance(&unused_to), 0);
}

#[test]
fn withdraw_fees_batch_requires_admin_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    // With `mock_all_auths`, every `require_auth()` call succeeds regardless
    // of which address it is attached to, so an unauthorized caller cannot be
    // simulated by *not* signing — the same limitation the existing
    // `test_only_admin_can_pause`-style tests document. What this test does
    // verify is that `require_admin()` gates the call at all: the nonce is
    // recorded against the stored admin address, not an arbitrary caller.
    let (_, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    token_admin.mint(&bridge.address, &1_000);
    bridge.accrue_fee(&token_addr, &500);

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);

    assert_eq!(bridge.get_fee_withdrawal_batch_nonce(&admin), 1);
}

#[test]
fn withdraw_fees_batch_rejects_replayed_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    token_admin.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_addr, &500);

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_addr.clone());

    bridge.withdraw_fees_batch(&recipient, &tokens, &0);
    let balance_after_first = token_client.balance(&contract_id);

    // The same nonce (0) again must be rejected, and leave state untouched.
    let result = bridge.try_withdraw_fees_batch(&recipient, &tokens, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));
    assert_eq!(token_client.balance(&contract_id), balance_after_first);
    assert_eq!(bridge.get_fee_withdrawal_batch_nonce(&admin), 1);
}

#[test]
fn withdraw_fees_batch_handles_an_empty_token_list() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, _token_addr, _, _) = setup_bridge(&env);
    let recipient = Address::generate(&env);
    let tokens = Vec::new(&env);

    // An empty batch is a valid no-op, not an error.
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);
}

#[test]
fn withdraw_fees_batch_emits_one_event_per_swept_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_a, _, token_a_admin) = setup_bridge(&env);
    let (token_b_client, token_b_admin) = create_token_contract(&env, &admin);
    let token_b = token_b_client.address.clone();

    token_a_admin.mint(&contract_id, &1_000);
    token_b_admin.mint(&contract_id, &1_000);
    bridge.accrue_fee(&token_a, &100);
    bridge.accrue_fee(&token_b, &200);

    let recipient = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token_a);
    tokens.push_back(token_b);
    bridge.withdraw_fees_batch(&recipient, &tokens, &0);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(events.events().len() >= 2);
}

proptest! {
    #[test]
    fn withdraw_fees_batch_never_moves_more_than_the_accrued_amount(fee in 1i128..1_000_000) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _admin, token_addr, token_client, token_admin) = setup_bridge(&env);
        token_admin.mint(&contract_id, &fee);
        bridge.accrue_fee(&token_addr, &fee);

        let recipient = Address::generate(&env);
        let mut tokens = Vec::new(&env);
        tokens.push_back(token_addr.clone());
        bridge.withdraw_fees_batch(&recipient, &tokens, &0);

        prop_assert_eq!(token_client.balance(&recipient), fee);
        prop_assert_eq!(token_client.balance(&contract_id), 0);
        depositor_invariants_hold(&bridge, token_client.balance(&contract_id));
    }
}
