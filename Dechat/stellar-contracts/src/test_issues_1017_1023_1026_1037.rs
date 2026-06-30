//! Regression tests for:
//! - #1017 `request_withdrawal` must reject amounts exceeding the user's deposited balance.
//! - #1023 `get_total_deposited` view returns the running total and 0 on empty state.
//! - #1026 `set_emergency_recovery` must reject the zero address.
//! - #1037 `init` must reject tokens that do not implement the SEP-41 interface.

#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    vec, Address, Bytes, Env, String,
};

use crate::{Error, FiatBridge, FiatBridgeClient};

const LIMIT: i128 = 1_000_000;

/// Registers a bridge initialised against a real Stellar asset (SEP-41) token.
fn setup(env: &Env) -> (FiatBridgeClient<'_>, Address, Address, StellarAssetClient<'_>) {
    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let token_sac = StellarAssetClient::new(env, &token_addr);

    let signers = vec![env, admin.clone()];
    client.init(&admin, &token_addr, &LIMIT, &1, &signers, &1);

    (client, admin, token_addr, token_sac)
}

// ── #1037: SEP-41 token validation in init ──────────────────────────────────

/// A valid Stellar asset contract is accepted by `init`.
#[test]
fn init_accepts_sep41_token() {
    let env = Env::default();
    env.mock_all_auths();
    // `setup` would panic if init rejected the SAC token.
    let (client, _admin, _token, _sac) = setup(&env);
    assert_eq!(client.get_total_deposited(), 0);
}

/// A registered contract that does not implement the SEP-41 interface is rejected.
#[test]
fn init_rejects_non_sep41_token() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    // Another bridge contract: it exists on-ledger but has no `decimals` method.
    let bogus_token = env.register(FiatBridge, ());
    let signers = vec![&env, admin.clone()];

    let result = client.try_init(&admin, &bogus_token, &LIMIT, &1, &signers, &1);
    assert_eq!(result, Err(Ok(Error::InvalidToken)));
}

// ── #1026: zero-address rejection in set_emergency_recovery ──────────────────

/// The all-zero account address (G…) is rejected as a recovery target.
#[test]
fn set_emergency_recovery_rejects_zero_account() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _sac) = setup(&env);

    let zero_account =
        Address::from_string(&String::from_str(&env, crate::ZERO_ACCOUNT_STRKEY));
    let result = client.try_set_emergency_recovery(&zero_account, &1_000);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));
}

/// The all-zero contract address (C…) is rejected as a recovery target.
#[test]
fn set_emergency_recovery_rejects_zero_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _sac) = setup(&env);

    let zero_contract =
        Address::from_string(&String::from_str(&env, crate::ZERO_CONTRACT_STRKEY));
    let result = client.try_set_emergency_recovery(&zero_contract, &1_000);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));
}

/// A normal address is still accepted.
#[test]
fn set_emergency_recovery_accepts_valid_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _sac) = setup(&env);

    let recovery = Address::generate(&env);
    client.set_emergency_recovery(&recovery, &1_000);
    assert_eq!(client.get_emergency_recovery_cap(), Some(1_000));
}

// ── #1017: per-user balance validation in request_withdrawal ─────────────────

/// A user cannot request more than they personally deposited, even when the
/// pool holds enough liquidity from other depositors.
#[test]
fn request_withdrawal_rejects_amount_above_user_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_addr, token_sac) = setup(&env);

    let small_depositor = Address::generate(&env);
    let whale = Address::generate(&env);
    token_sac.mint(&small_depositor, &10_000);
    token_sac.mint(&whale, &10_000);

    client.deposit(&small_depositor, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    client.deposit(&whale, &5_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Pool holds 5_100, but the small depositor only ever deposited 100.
    let result =
        client.try_request_withdrawal(&small_depositor, &500, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

/// A request up to the user's deposited balance succeeds.
#[test]
fn request_withdrawal_allows_up_to_user_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_addr, token_sac) = setup(&env);

    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    client.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let req_id = client.request_withdrawal(&user, &1_000, &token_addr, &None, &0);
    assert_eq!(req_id, 0);
}

// ── #1023: get_total_deposited view ─────────────────────────────────────────

/// On a freshly registered (uninitialised) contract the view returns 0.
#[test]
fn get_total_deposited_zero_before_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    assert_eq!(client.get_total_deposited(), 0);
}

/// The view reports the cumulative sum of all users' deposits.
#[test]
fn get_total_deposited_sums_all_deposits() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_addr, token_sac) = setup(&env);

    assert_eq!(client.get_total_deposited(), 0);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_sac.mint(&alice, &10_000);
    token_sac.mint(&bob, &10_000);

    client.deposit(&alice, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);
    client.deposit(&bob, &700, &token_addr, &Bytes::new(&env), &0, &0, &None);

    assert_eq!(client.get_total_deposited(), 1_000);
}
