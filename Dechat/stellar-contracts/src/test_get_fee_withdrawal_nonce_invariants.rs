//! Invariant tests for [`FiatBridge::get_fee_withdrawal_nonce`].
//!
//! A pure storage read with no authorisation requirement — any caller may
//! query any address's nonce. The invariants asserted here are:
//!
//! * defaults to `0` for a caller who has never withdrawn fees, and never
//!   panics, including on an uninitialized contract;
//! * is a pure read: calling it repeatedly never mutates storage or the
//!   nonce itself;
//! * advances by exactly one on every successful `withdraw_fees` /
//!   `withdraw_fees_batch` call, and the two entrypoints share one sequence
//!   per caller (Issue #1420/#1421);
//! * is tracked independently per caller;
//! * a rejected call (stale or future nonce, no fees accrued, amount above
//!   the accrued balance) leaves the nonce — and every other counter —
//!   unchanged, since `withdraw_fees`/`withdraw_fees_batch` only consume the
//!   nonce after every other check has passed.

#![allow(deprecated)]

use crate::{DataKey, Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
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

    // Seed the fee vault directly, as test_fee_withdrawal_nonce.rs does.
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &10_000_000i128);
    });
    StellarAssetClient::new(env, &token_addr).mint(&contract_id, &10_000_000i128);

    (contract_id, client, admin, token_addr, token)
}

#[test]
fn defaults_to_zero_for_a_caller_with_no_history() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, _, _) = setup(&env);
    let stranger = Address::generate(&env);

    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 0);
    assert_eq!(client.get_fee_withdrawal_nonce(&stranger), 0);
}

#[test]
fn does_not_panic_on_uninitialized_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);
    let caller = Address::generate(&env);

    assert_eq!(client.get_fee_withdrawal_nonce(&caller), 0);
}

#[test]
fn is_a_pure_read_with_no_side_effects() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, _, _) = setup(&env);

    for _ in 0..5 {
        let _ = client.get_fee_withdrawal_nonce(&admin);
    }
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 0);
}

#[test]
fn advances_by_one_per_successful_withdraw_fees_call() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, token_addr, _) = setup(&env);

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);

    client.withdraw_fees(&admin, &token_addr, &1_000, &1);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 2);
}

#[test]
fn withdraw_fees_and_withdraw_fees_batch_advance_the_same_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, token_addr, _) = setup(&env);

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);

    let tokens = vec![&env, token_addr.clone()];
    client.withdraw_fees_batch(&admin, &tokens, &1);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 2);
}

#[test]
fn is_tracked_independently_per_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, token_addr, _) = setup(&env);
    let other = Address::generate(&env);

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);

    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);
    assert_eq!(client.get_fee_withdrawal_nonce(&other), 0);
}

#[test]
fn rejected_stale_nonce_leaves_it_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, token_addr, _) = setup(&env);

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);

    // Replaying nonce 0 (already consumed) is stale.
    let result = client.try_withdraw_fees(&admin, &token_addr, &1_000, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);
}

#[test]
fn rejected_future_nonce_leaves_it_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, token_addr, _) = setup(&env);

    let result = client.try_withdraw_fees(&admin, &token_addr, &1_000, &5);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 0);
}

#[test]
fn a_failing_withdrawal_with_a_valid_nonce_does_not_consume_it() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, admin, _, _) = setup(&env);

    // A token with no accrued fees: the nonce is checked but not consumed,
    // since `withdraw_fees` only advances it after every other check passes.
    let empty_vault_token = Address::generate(&env);
    let result = client.try_withdraw_fees(&admin, &empty_vault_token, &1_000, &0);
    assert_eq!(result, Err(Ok(Error::NoFeesToWithdraw)));
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 0);
}

proptest! {
    #[test]
    fn nonce_after_n_successful_withdrawals_equals_n(n in 1u64..20) {
        let env = Env::default();
        env.mock_all_auths();

        let (_, client, admin, token_addr, _) = setup(&env);

        for i in 0..n {
            client.withdraw_fees(&admin, &token_addr, &1, &i);
        }
        prop_assert_eq!(client.get_fee_withdrawal_nonce(&admin), n);
    }
}
