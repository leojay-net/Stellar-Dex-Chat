#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

// ── helpers ──────────────────────────────────────────────────────────

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
    limit: i128,
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
    // The generated client panics on contract errors; unwrap is valid here
    bridge.init(&admin, &token_addr, &limit);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

// ── happy-path tests ──────────────────────────────────────────────────

#[test]
fn test_deposit_and_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200);
    assert_eq!(token.balance(&user), 800);
    assert_eq!(token.balance(&contract_id), 200);

    // Default lock period is 0
    let req_id = bridge.request_withdrawal(&user, &100);
    bridge.execute_withdrawal(&req_id);

    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

#[test]
fn test_time_locked_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200);

    bridge.set_lock_period(&100);
    assert_eq!(bridge.get_lock_period(), 100);

    let start_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100);

    // Check request details
    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.amount, 100);
    assert_eq!(req.unlock_ledger, start_ledger + 100);

    // Try to execute too early
    let result = bridge.try_execute_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence = start_ledger + 100;
    });

    bridge.execute_withdrawal(&req_id);
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
    assert_eq!(bridge.get_withdrawal_request(&req_id), None);
}

#[test]
fn test_cancel_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200);

    let req_id = bridge.request_withdrawal(&user, &100);
    assert!(bridge.get_withdrawal_request(&req_id).is_some());

    bridge.cancel_withdrawal(&req_id);
    assert!(bridge.get_withdrawal_request(&req_id).is_none());

    let result = bridge.try_execute_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::RequestNotFound)));
}

#[test]
fn test_view_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 300);
    let user = Address::generate(&env);
    token_sac.mint(&user, &500);

    assert_eq!(bridge.get_admin(), admin);
    assert_eq!(bridge.get_token(), token_addr);
    assert_eq!(bridge.get_limit(), 300);
    assert_eq!(bridge.get_balance(), 0);
    assert_eq!(bridge.get_total_deposited(), 0);

    bridge.deposit(&user, &200);
    assert_eq!(bridge.get_balance(), 200);
    assert_eq!(bridge.get_total_deposited(), 200);

    bridge.deposit(&user, &100);
    assert_eq!(bridge.get_total_deposited(), 300);
}

#[test]
fn test_set_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 100);
    bridge.set_limit(&500);
    assert_eq!(bridge.get_limit(), 500);
    bridge.set_limit(&50);
    assert_eq!(bridge.get_limit(), 50);
}

#[test]
fn test_set_and_get_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 100);
    assert_eq!(bridge.get_cooldown(), 0);

    bridge.set_cooldown(&12);
    assert_eq!(bridge.get_cooldown(), 12);

    bridge.set_cooldown(&0);
    assert_eq!(bridge.get_cooldown(), 0);
}

#[test]
fn test_deposit_cooldown_blocks_rapid_second_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&10);
    let start_ledger = env.ledger().sequence();

    bridge.deposit(&user, &100);
    assert_eq!(bridge.get_last_deposit_ledger(&user), Some(start_ledger));

    let result = bridge.try_deposit(&user, &50);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_deposit_succeeds_after_cooldown_period() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&7);
    let start_ledger = env.ledger().sequence();

    bridge.deposit(&user, &100);

    env.ledger().with_mut(|li| {
        li.sequence = start_ledger + 7;
    });

    bridge.deposit(&user, &50);
}

#[test]
fn test_deposit_cooldown_is_per_address_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &1_000);
    token_sac.mint(&user_b, &1_000);

    bridge.set_cooldown(&10);

    bridge.deposit(&user_a, &100);

    // Different address is unaffected by user_a cooldown
    bridge.deposit(&user_b, &100);

    // user_a still blocked in cooldown window
    let result = bridge.try_deposit(&user_a, &50);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_last_deposit_record_expires_with_ttl() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&5);
    let start_ledger = env.ledger().sequence();
    bridge.deposit(&user, &100);
    assert_eq!(bridge.get_last_deposit_ledger(&user), Some(start_ledger));

    // Move beyond cooldown TTL so temporary key naturally expires.
    env.ledger().with_mut(|li| {
        li.sequence = start_ledger + 6;
    });

    assert_eq!(bridge.get_last_deposit_ledger(&user), None);
}

#[test]
fn test_transfer_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 100);
    let new_admin = Address::generate(&env);
    bridge.transfer_admin(&new_admin);
    assert_eq!(bridge.get_admin(), new_admin);
}

// ── error-case tests ──────────────────────────────────────────────────

#[test]
fn test_over_limit_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let result = bridge.try_deposit(&user, &600);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_zero_amount_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);
    let user = Address::generate(&env);

    let result = bridge.try_deposit(&user, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_insufficient_funds_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100);

    let req_id = bridge.request_withdrawal(&user, &200);
    let result = bridge.try_execute_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_double_init() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 500);
    let result = bridge.try_init(&admin, &token_addr, &500);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
