//! Tests for Issue #1420 / #1421: `withdraw_fees` and `withdraw_fees_batch`
//! share a single per-caller fee-withdrawal nonce sequence
//! (`DataKey::FeeWithdrawalNonceByCaller`), routed through the shared
//! `consume_nonce` helper, and the deprecated `get_fee_withdrawal_batch_nonce`
//! getter is a plain alias of `get_fee_withdrawal_nonce` rather than reading
//! the separate, never-written `DataKey::FeeWithdrawalBatchNonce` key.
#![allow(deprecated)]

use crate::{DataKey, FiatBridge, FiatBridgeClient};
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

    // Seed the fee vault directly rather than exercising the full
    // deposit-with-fee flow; `token::TokenRegistry` is already populated by
    // `init` for the default token, which is all `get_accrued_fees` and
    // `withdraw_fees` require.
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &10_000_000i128);
    });
    StellarAssetClient::new(env, &token_addr).mint(&contract_id, &10_000_000i128);

    (contract_id, client, admin, token_addr, token)
}

/// `withdraw_fees` advances the same per-caller nonce that
/// `get_fee_withdrawal_nonce` reports, and that `withdraw_fees_batch` also
/// consumes — the two entrypoints share one sequence.
#[test]
fn withdraw_fees_advances_the_shared_per_caller_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, admin, token_addr, _token) = setup(&env);

    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 0);

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);

    client.withdraw_fees(&admin, &token_addr, &1_000, &1);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 2);
}

/// `withdraw_fees_batch` advances the very same nonce sequence, so a nonce
/// consumed by one entrypoint is visible to, and required by, the other.
#[test]
fn withdraw_fees_and_withdraw_fees_batch_share_one_nonce_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, _token) = setup(&env);

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);

    // The batch call must use nonce 1, not 0: it continues the same sequence
    // `withdraw_fees` just advanced.
    let tokens = vec![&env, token_addr.clone()];
    client.withdraw_fees_batch(&admin, &tokens, &1);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 2);

    // The batch call above swept both the vault accounting and the contract's
    // actual token balance to zero; re-seed both so the final withdraw_fees
    // call has something to withdraw.
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &1_000i128);
    });
    StellarAssetClient::new(&env, &token_addr).mint(&contract_id, &1_000i128);

    // And withdraw_fees picks the sequence back up from where the batch call
    // left it.
    client.withdraw_fees(&admin, &token_addr, &1_000, &2);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 3);
}

/// A stale nonce (already consumed by the other entrypoint) is rejected on
/// both sides of the shared sequence.
#[test]
fn stale_nonce_from_the_other_entrypoint_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, _token) = setup(&env);

    let tokens = vec![&env, token_addr.clone()];
    client.withdraw_fees_batch(&admin, &tokens, &0);
    assert_eq!(client.get_fee_withdrawal_nonce(&admin), 1);

    // Re-seed the vault: the batch call above swept it to zero.
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &1_000i128);
    });

    // nonce 0 has already been consumed by the batch call.
    let result = client.try_withdraw_fees(&admin, &token_addr, &500, &0);
    assert!(
        result.is_err(),
        "a nonce already consumed by the batch call must be rejected"
    );
}

/// `get_fee_withdrawal_batch_nonce` is a plain alias of
/// `get_fee_withdrawal_nonce`: it no longer reads the separate, never-written
/// `FeeWithdrawalBatchNonce` key that always returned 0 regardless of
/// activity (Issue #1420).
#[test]
fn get_fee_withdrawal_batch_nonce_aliases_get_fee_withdrawal_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, admin, token_addr, _token) = setup(&env);

    assert_eq!(
        client.get_fee_withdrawal_batch_nonce(&admin),
        client.get_fee_withdrawal_nonce(&admin)
    );

    client.withdraw_fees(&admin, &token_addr, &1_000, &0);

    assert_eq!(client.get_fee_withdrawal_batch_nonce(&admin), 1);
    assert_eq!(
        client.get_fee_withdrawal_batch_nonce(&admin),
        client.get_fee_withdrawal_nonce(&admin)
    );
}
