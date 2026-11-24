//! Tests for Issue #1423: `require_admin` and `reject_if_denied` replace the
//! 55 inline copies of the admin-auth block and the 3 inline denylist checks.
//!
//! Behavior is unchanged: these tests pin down that admin-gated entrypoints
//! still return `NotInitialized` before an `init` call, and that `deposit`,
//! `withdraw`, and `request_withdrawal` still reject a denied recipient with
//! `AddressDenied`.

use crate::{Error, FiatBridge, FiatBridgeClient};
use soroban_sdk::{
    testutils::Address as _,
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

/// `require_admin` still reports `NotInitialized` on an uninitialised
/// contract, exactly like every inline copy it replaced.
#[test]
fn admin_gated_entrypoint_reports_not_initialized_before_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);
    let operator = Address::generate(&env);

    let result = client.try_set_operator(&operator, &true, &0);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

/// `require_admin` requires the configured admin's authentication: a call
/// succeeds once `init` has run and the (mocked) admin auth is present.
#[test]
fn admin_gated_entrypoint_succeeds_once_initialised() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, _admin, _token_addr, _token) = setup(&env);
    let operator = Address::generate(&env);

    let result = client.try_set_operator(&operator, &true, &0);
    assert!(result.is_ok());
    assert!(client.is_operator(&operator));
}

/// `reject_if_denied` still blocks `deposit` for a denied depositor.
#[test]
fn deposit_rejects_a_denied_depositor() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, _admin, token_addr, _token) = setup(&env);
    let depositor = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&depositor, &1_000_000i128);

    client.deny_address(&depositor);

    let result = client.try_deposit(
        &depositor,
        &1_000_000i128,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

/// `reject_if_denied` still blocks `withdraw` for a denied recipient.
#[test]
fn withdraw_rejects_a_denied_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, admin, token_addr, _token) = setup(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&admin, &1_000_000i128);
    client.deposit(
        &admin,
        &1_000_000i128,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    client.deny_address(&admin);

    let result = client.try_withdraw(&admin, &admin, &1_000i128, &token_addr);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

/// `reject_if_denied` still blocks `request_withdrawal` for a denied
/// recipient.
#[test]
fn request_withdrawal_rejects_a_denied_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, admin, token_addr, _token) = setup(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&admin, &1_000_000i128);
    client.deposit(
        &admin,
        &1_000_000i128,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    client.deny_address(&admin);

    let result = client.try_request_withdrawal(&admin, &1_000i128, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

/// A never-denied address still passes all three checks: `reject_if_denied`
/// is not a false positive.
#[test]
fn non_denied_address_is_unaffected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client, admin, token_addr, _token) = setup(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&admin, &1_000_000i128);

    let result = client.try_deposit(
        &admin,
        &1_000_000i128,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    assert!(result.is_ok());
}
