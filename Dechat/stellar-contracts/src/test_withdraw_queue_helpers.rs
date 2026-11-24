//! Tests for Issue #1424: `execute_withdrawal`, `cancel_withdrawal`, and
//! `reclaim_expired_withdrawal` now share `remove_from_withdraw_queue` and
//! `release_liability` instead of each repeating the same
//! remove/decrement/advance sequence and an unchecked `total_liabilities -=`.
//!
//! Also covers the fix folded in with the refactor: `reclaim_expired_withdrawal`
//! previously skipped the pause check and `check_invariants` that the other
//! two entrypoints already ran.

use crate::{DataKey, Error, FiatBridge, FiatBridgeClient, TokenConfig};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, Env,
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

    let signers = soroban_sdk::vec![env, admin.clone()];
    client.init(
        &admin,
        &token_addr,
        &10_000_000i128,
        &1i128,
        &signers,
        &1,
        &0,
    );

    StellarAssetClient::new(env, &token_addr).mint(&admin, &10_000_000i128);
    client.deposit(
        &admin,
        &10_000_000i128,
        &token_addr,
        &Bytes::new(env),
        &0,
        &0,
        &None,
    );

    (contract_id, client, admin, token_addr, token)
}

fn queue_len(env: &Env, contract_id: &Address) -> u64 {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawQueueLen)
            .unwrap_or(0)
    })
}

fn tier_len(env: &Env, contract_id: &Address, tier: u32) -> u64 {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::TierQueueLen(tier))
            .unwrap_or(0)
    })
}

fn total_liabilities(env: &Env, contract_id: &Address, token: &Address) -> i128 {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get::<_, TokenConfig>(&DataKey::TokenRegistry(token.clone()))
            .unwrap()
            .total_liabilities
    })
}

#[test]
fn execute_withdrawal_removes_from_queue_and_releases_liability() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, _token) = setup(&env);
    let id = client.request_withdrawal(&admin, &1_000i128, &token_addr, &None, &0);

    assert_eq!(queue_len(&env, &contract_id), 1);
    assert_eq!(tier_len(&env, &contract_id, 0), 1);
    assert_eq!(total_liabilities(&env, &contract_id, &token_addr), 1_000);

    client.execute_withdrawal(&id, &None, &0i128, &0u32, &0u64);

    assert_eq!(queue_len(&env, &contract_id), 0);
    assert_eq!(tier_len(&env, &contract_id, 0), 0);
    assert_eq!(total_liabilities(&env, &contract_id, &token_addr), 0);
    assert!(client.get_withdrawal_request(&id).is_none());
}

#[test]
fn cancel_withdrawal_removes_from_queue_and_releases_liability() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, _token) = setup(&env);
    let id = client.request_withdrawal(&admin, &1_000i128, &token_addr, &None, &0);

    client.cancel_withdrawal(&id);

    assert_eq!(queue_len(&env, &contract_id), 0);
    assert_eq!(tier_len(&env, &contract_id, 0), 0);
    assert_eq!(total_liabilities(&env, &contract_id, &token_addr), 0);
    assert!(client.get_withdrawal_request(&id).is_none());
}

#[test]
fn reclaim_expired_withdrawal_removes_from_queue_and_releases_liability() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, _token) = setup(&env);
    let id = client.request_withdrawal(&admin, &1_000i128, &token_addr, &None, &0);

    // Reject before the expiry window has passed.
    let too_early = client.try_reclaim_expired_withdrawal(&id);
    assert_eq!(too_early, Err(Ok(Error::WithdrawalLocked)));

    let expiry_window = client.get_withdrawal_expiry();
    env.ledger().with_mut(|l| {
        l.sequence_number = l
            .sequence_number
            .saturating_add(expiry_window)
            .saturating_add(1)
    });

    client.reclaim_expired_withdrawal(&id);

    assert_eq!(queue_len(&env, &contract_id), 0);
    assert_eq!(tier_len(&env, &contract_id, 0), 0);
    assert_eq!(total_liabilities(&env, &contract_id, &token_addr), 0);
    assert!(client.get_withdrawal_request(&id).is_none());
}

/// Issue #1424: `reclaim_expired_withdrawal` used to skip the pause check
/// that `execute_withdrawal` and `cancel_withdrawal` already had.
#[test]
fn reclaim_expired_withdrawal_now_respects_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, admin, token_addr, _token) = setup(&env);
    let id = client.request_withdrawal(&admin, &1_000i128, &token_addr, &None, &0);

    let expiry_window = client.get_withdrawal_expiry();
    env.ledger().with_mut(|l| {
        l.sequence_number = l
            .sequence_number
            .saturating_add(expiry_window)
            .saturating_add(1)
    });

    client.pause();

    let result = client.try_reclaim_expired_withdrawal(&id);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

/// Cancelling and reclaiming operate correctly on distinct tiers, proving
/// `remove_from_withdraw_queue` decrements the right tier's counter rather
/// than a shared/global one.
#[test]
fn per_tier_bookkeeping_is_independent_across_entrypoints() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, _token) = setup(&env);
    let id_tier0 = client.request_withdrawal(&admin, &1_000i128, &token_addr, &None, &0);
    let id_tier1 = client.request_withdrawal(&admin, &1_000i128, &token_addr, &None, &1);

    assert_eq!(tier_len(&env, &contract_id, 0), 1);
    assert_eq!(tier_len(&env, &contract_id, 1), 1);

    client.cancel_withdrawal(&id_tier0);

    assert_eq!(
        tier_len(&env, &contract_id, 0),
        0,
        "cancelling tier 0 must not touch tier 1"
    );
    assert_eq!(tier_len(&env, &contract_id, 1), 1);

    client.execute_withdrawal(&id_tier1, &None, &0i128, &0u32, &0u64);
    assert_eq!(tier_len(&env, &contract_id, 1), 0);
}
