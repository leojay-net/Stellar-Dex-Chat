#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, Env,
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
    bridge.init(&admin, &token_addr, &limit);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

// ── happy-path tests ──────────────────────────────────────────────────

#[test]
fn test_deposit_and_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    assert_eq!(token.balance(&user), 800);
    assert_eq!(token.balance(&contract_id), 200);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    let operator = Address::generate(&env);
    bridge.execute_withdrawal(&operator, &req_id, &None);

    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

#[test]
fn test_time_locked_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));

    bridge.set_lock_period(&100);
    assert_eq!(bridge.get_lock_period(), 100);

    let start_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);

    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.token, token_addr);
    assert_eq!(req.amount, 100);
    assert_eq!(req.unlock_ledger, start_ledger + 100);

    let operator = Address::generate(&env);
    let result = bridge.try_execute_withdrawal(&operator, &req_id, &None);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 100;
    });

    bridge.execute_withdrawal(&operator, &req_id, &None);
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
    assert_eq!(bridge.get_withdrawal_request(&req_id), None);
}

#[test]
fn test_cancel_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    assert!(bridge.get_withdrawal_request(&req_id).is_some());

    bridge.cancel_withdrawal(&req_id);
    assert!(bridge.get_withdrawal_request(&req_id).is_none());

    let operator = Address::generate(&env);
    let result = bridge.try_execute_withdrawal(&operator, &req_id, &None);
    assert_eq!(result, Err(Ok(Error::RequestNotFound)));
}

#[test]
fn test_view_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 300);
    assert_eq!(bridge.get_admin(), admin);
}

#[test]
fn test_deposit_cooldown_blocks_rapid_second_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&10);
    assert_eq!(bridge.get_cooldown(), 10);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_deposit_succeeds_after_cooldown_period() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&10);
    let start_ledger = env.ledger().sequence();
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 10;
    });

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_user_deposited(&user), 200);
}

#[test]
fn test_deposit_cooldown_is_per_address_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &500);
    token_sac.mint(&user_b, &500);

    bridge.set_cooldown(&10);
    bridge.deposit(&user_a, &50, &token_addr, &Bytes::new(&env));
    
    // user_b not blocked
    bridge.deposit(&user_b, &50, &token_addr, &Bytes::new(&env));
    
    // user_a still blocked
    let result = bridge.try_deposit(&user_a, &50, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_last_deposit_record_expires_with_ttl() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&5);
    let start_ledger = env.ledger().sequence();
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_last_deposit_ledger(&user), Some(start_ledger));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 20000;
    });

    assert_eq!(bridge.get_last_deposit_ledger(&user), None);
}

#[test]
fn test_transfer_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env, 100);
    let new_admin = Address::generate(&env);

    bridge.transfer_admin(&new_admin);
    bridge.accept_admin();

    assert_eq!(bridge.get_admin(), new_admin);
}

#[test]
fn test_set_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
    bridge.set_limit(&token_addr, &1000);
    assert_eq!(bridge.get_limit(), 1000);
}

#[test]
fn test_over_limit_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let result = bridge.try_deposit(&user, &600, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_execute_withdrawal_operator_limit_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    let operator = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env));
    bridge.set_operator_daily_limit(&operator, &150);

    let req1 = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&operator, &req1, &None);

    let req2 = bridge.request_withdrawal(&user, &100, &token_addr);
    let result = bridge.try_execute_withdrawal(&operator, &req2, &None);
    assert_eq!(result, Err(Ok(Error::OperatorDailyLimitExceeded)));
}

#[test]
fn test_execute_withdrawal_operator_limit_resets_after_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    let operator = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env));
    bridge.set_operator_daily_limit(&operator, &150);

    let req1 = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&operator, &req1, &None);

    let start_ledger = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + WINDOW_LEDGERS;
    });

    let req2 = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&operator, &req2, &None);
    assert_eq!(token_sac.balance(&user), 700);
}

#[test]
fn test_zero_amount_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
    let user = Address::generate(&env);

    let result = bridge.try_deposit(&user, &0, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_insufficient_funds_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));

    let req_id = bridge.request_withdrawal(&user, &200, &token_addr);
    let operator = Address::generate(&env);
    let result = bridge.try_execute_withdrawal(&operator, &req_id, &None);
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

#[test]
fn test_per_user_deposit_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    token_sac.mint(&user1, &500);
    token_sac.mint(&user2, &500);

    assert_eq!(bridge.get_user_deposited(&user1), 0);
    assert_eq!(bridge.get_user_deposited(&user2), 0);

    bridge.deposit(&user1, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_user_deposited(&user1), 100);
    assert_eq!(bridge.get_total_deposited(), 100);

    bridge.deposit(&user1, &50, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 150);

    bridge.deposit(&user2, &200, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_user_deposited(&user2), 200);
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 350);
}
