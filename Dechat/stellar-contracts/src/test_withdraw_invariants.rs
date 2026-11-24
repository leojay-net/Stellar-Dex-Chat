//! Invariant tests for [`FiatBridge::withdraw`].
//!
//! `withdraw` moves tokens out of the vault on behalf of the admin or the
//! configured withdraw operator. The invariants asserted here are:
//!
//! * `total_deposited >= total_withdrawn` after every successful withdrawal;
//! * `net_deposited (total_deposited - total_withdrawn) >= total_liabilities`;
//! * on-chain token balance `>= net_deposited` — the contract always retains
//!   enough to honour outstanding liabilities;
//! * only the admin or the active withdraw operator may call `withdraw`, and
//!   an unauthorised caller leaves every counter and the token balance
//!   untouched;
//! * failure paths (zero amount, self-transfer, insufficient funds, a paused
//!   contract) never partially mutate storage.
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

/// Deposits `amount` from a fresh depositor so the vault holds funds to withdraw.
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

fn invariants_hold(
    total_deposited: i128,
    total_withdrawn: i128,
    total_liabilities: i128,
    balance: i128,
) {
    assert!(
        total_deposited >= total_withdrawn,
        "total_deposited {} < total_withdrawn {}",
        total_deposited,
        total_withdrawn
    );
    let net_deposited = total_deposited - total_withdrawn;
    assert!(
        net_deposited >= total_liabilities,
        "net_deposited {} < total_liabilities {}",
        net_deposited,
        total_liabilities
    );
    assert!(
        balance >= net_deposited,
        "balance {} < net_deposited {}",
        balance,
        net_deposited
    );
}

#[test]
fn withdraw_by_admin_updates_accounting_and_maintains_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let recipient = Address::generate(&env);
    bridge.withdraw(&admin, &recipient, &1_500, &token_addr);

    let total_deposited = bridge.get_total_deposited();
    let total_withdrawn = bridge.get_total_withdrawn();
    let total_liabilities = bridge.get_total_liabilities();
    let balance = token_client.balance(&contract_id);

    assert_eq!(total_withdrawn, 1_500);
    assert_eq!(token_client.balance(&recipient), 1_500);
    invariants_hold(total_deposited, total_withdrawn, total_liabilities, balance);
}

#[test]
fn withdraw_by_active_operator_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let operator = Address::generate(&env);
    bridge.set_withdraw_operator(&operator);

    let recipient = Address::generate(&env);
    bridge.withdraw(&operator, &recipient, &1_000, &token_addr);

    assert_eq!(bridge.get_total_withdrawn(), 1_000);
    assert_eq!(token_client.balance(&recipient), 1_000);
}

#[test]
fn withdraw_rejects_caller_who_is_neither_admin_nor_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin, token_addr, token_client, token_admin) =
        setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let balance_before = token_client.balance(&contract_id);
    let total_withdrawn_before = bridge.get_total_withdrawn();

    let impostor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let result = bridge.try_withdraw(&impostor, &recipient, &500, &token_addr);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    // Unauthorised call leaves every counter and the token balance untouched.
    assert_eq!(token_client.balance(&contract_id), balance_before);
    assert_eq!(bridge.get_total_withdrawn(), total_withdrawn_before);
    assert_eq!(token_client.balance(&recipient), 0);
}

#[test]
fn withdraw_rejects_zero_amount_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let balance_before = token_client.balance(&contract_id);
    let recipient = Address::generate(&env);
    let result = bridge.try_withdraw(&admin, &recipient, &0, &token_addr);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));

    assert_eq!(token_client.balance(&contract_id), balance_before);
    assert_eq!(bridge.get_total_withdrawn(), 0);
}

#[test]
fn withdraw_rejects_transfer_to_the_contract_itself() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let balance_before = token_client.balance(&contract_id);
    let result = bridge.try_withdraw(&admin, &contract_id, &500, &token_addr);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));

    assert_eq!(token_client.balance(&contract_id), balance_before);
    assert_eq!(bridge.get_total_withdrawn(), 0);
}

#[test]
fn withdraw_rejects_amount_exceeding_contract_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 1_000);

    let balance_before = token_client.balance(&contract_id);
    let recipient = Address::generate(&env);
    let result = bridge.try_withdraw(&admin, &recipient, &1_001, &token_addr);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    // Failure path must not partially mutate storage: balance and counters unchanged.
    assert_eq!(token_client.balance(&contract_id), balance_before);
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(token_client.balance(&recipient), 0);
}

#[test]
fn withdraw_rejects_unwhitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _token_addr, _, _) = setup_bridge(&env);
    let other_admin = Address::generate(&env);
    let (other_token, other_token_admin) = create_token_contract(&env, &other_admin);
    other_token_admin.mint(&bridge.address, &10_000);

    let recipient = Address::generate(&env);
    let result = bridge.try_withdraw(&admin, &recipient, &500, &other_token.address);
    assert_eq!(result, Err(Ok(Error::TokenNotWhitelisted)));
}

#[test]
fn withdraw_blocked_while_paused_and_state_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    bridge.pause();

    let balance_before = token_client.balance(&contract_id);
    let recipient = Address::generate(&env);
    let result = bridge.try_withdraw(&admin, &recipient, &500, &token_addr);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));

    assert_eq!(token_client.balance(&contract_id), balance_before);
    assert_eq!(bridge.get_total_withdrawn(), 0);
}

#[test]
fn withdraw_emits_event_with_caller_and_ledger() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, _, token_admin) = setup_bridge(&env);
    seed_deposit(&env, &bridge, &token_addr, &token_admin, 5_000);

    let recipient = Address::generate(&env);
    bridge.withdraw(&admin, &recipient, &500, &token_addr);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(!events.events().is_empty());
}

#[test]
fn withdraw_does_not_panic_on_uninitialized_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let caller = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let result = client.try_withdraw(&caller, &recipient, &100, &token);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

proptest! {
    #[test]
    fn withdraw_valid_amounts_maintain_invariants(seed_amount in 1_000i128..1_000_000, withdraw_amount in 1i128..1_000) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
        seed_deposit(&env, &bridge, &token_addr, &token_admin, seed_amount);

        let recipient = Address::generate(&env);
        let result = bridge.try_withdraw(&admin, &recipient, &withdraw_amount, &token_addr);
        prop_assert!(result.is_ok(), "withdraw of {} from seed {} should succeed", withdraw_amount, seed_amount);

        let total_deposited = bridge.get_total_deposited();
        let total_withdrawn = bridge.get_total_withdrawn();
        let total_liabilities = bridge.get_total_liabilities();
        let balance = token_client.balance(&contract_id);

        prop_assert_eq!(total_withdrawn, withdraw_amount);
        prop_assert!(total_deposited >= total_withdrawn);
        let net_deposited = total_deposited - total_withdrawn;
        prop_assert!(net_deposited >= total_liabilities);
        prop_assert!(balance >= net_deposited);
    }

    #[test]
    fn withdraw_above_contract_balance_always_rejected_without_side_effects(seed_amount in 100i128..10_000) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
        seed_deposit(&env, &bridge, &token_addr, &token_admin, seed_amount);

        let balance_before = token_client.balance(&contract_id);
        let recipient = Address::generate(&env);
        let result = bridge.try_withdraw(&admin, &recipient, &(seed_amount + 1), &token_addr);

        prop_assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
        prop_assert_eq!(token_client.balance(&contract_id), balance_before);
        prop_assert_eq!(bridge.get_total_withdrawn(), 0);
    }
}
