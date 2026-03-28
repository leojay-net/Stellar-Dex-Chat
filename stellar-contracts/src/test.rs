#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(token.balance(&user), 800);
    assert_eq!(token.balance(&contract_id), 200);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);

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
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0);

    bridge.set_lock_period(&100);
    assert_eq!(bridge.get_lock_period(), 100);

    let start_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);

    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.token, token_addr);
    assert_eq!(req.amount, 100);
    assert_eq!(req.unlock_ledger, start_ledger + 100);

    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 100;
    });

    bridge.execute_withdrawal(&req_id, &None, &0, &0);
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
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    assert!(bridge.get_withdrawal_request(&req_id).is_some());

    bridge.cancel_withdrawal(&req_id);
    assert!(bridge.get_withdrawal_request(&req_id).is_none());

    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(result, Err(Ok(Error::RequestNotFound)));
}

#[test]
fn test_view_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _token_addr, _, _) = setup_bridge(&env, 300);
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

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);
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
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 10;
    });

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);
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
    bridge.deposit(&user_a, &50, &token_addr, &Bytes::new(&env), &0, &0);

    // user_b not blocked
    bridge.deposit(&user_b, &50, &token_addr, &Bytes::new(&env), &0, &0);

    // user_a still blocked
    let result = bridge.try_deposit(&user_a, &50, &token_addr, &Bytes::new(&env), &0, &0);
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
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);
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

    let (_, bridge, _admin, _, _, _) = setup_bridge(&env, 100);
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

    let result = bridge.try_deposit(&user, &600, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_zero_amount_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
    let user = Address::generate(&env);

    let result = bridge.try_deposit(&user, &0, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_insufficient_funds_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);

    // Requesting more than net deposits (100) should fail due to invariant check
    let result = bridge.try_request_withdrawal(&user, &200, &token_addr);
    assert_eq!(result, Err(Ok(Error::InternalError)));
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

    bridge.deposit(&user1, &100, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(bridge.get_user_deposited(&user1), 100);
    assert_eq!(bridge.get_total_deposited(), 100);

    bridge.deposit(&user1, &50, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 150);

    bridge.deposit(&user2, &200, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(bridge.get_user_deposited(&user2), 200);
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 350);
}

#[test]
fn test_get_config_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 1000);

    bridge.set_cooldown(&12);

    let oracle_addr = Address::generate(&env);
    bridge.set_oracle(&oracle_addr);

    let config = bridge.get_config_snapshot();
    assert_eq!(config.admin, admin);
    assert_eq!(config.token, token_addr);
    assert_eq!(config.cooldown_ledgers, 12);
    assert_eq!(config.fiat_limit, None);
    assert_eq!(config.oracle, Some(oracle_addr));
    assert_eq!(config.allowlist_enabled, false);
}

#[test]
fn test_total_withdrawn_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(bridge.get_total_withdrawn(), 0);

    bridge.withdraw(&user, &200, &token_addr);
    assert_eq!(bridge.get_total_withdrawn(), 200);
    assert_eq!(token.balance(&contract_id), 300);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(bridge.get_total_withdrawn(), 300);
}

#[test]
fn test_total_liabilities_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(bridge.get_total_liabilities(), 0);

    let req1 = bridge.request_withdrawal(&user, &100, &token_addr);
    assert_eq!(bridge.get_total_liabilities(), 100);

    let req2 = bridge.request_withdrawal(&user, &50, &token_addr);
    assert_eq!(bridge.get_total_liabilities(), 150);

    bridge.execute_withdrawal(&req1, &None, &0, &0);
    assert_eq!(bridge.get_total_liabilities(), 50);

    bridge.cancel_withdrawal(&req2);
    assert_eq!(bridge.get_total_liabilities(), 0);
}

#[test]
fn test_invariant_violation_insufficent_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0);
    
    // Manually burn some tokens from the contract to break invariant
    // We need to use the token admin for this (token_sac admin is token_admin)
    // setup_bridge returns token_admin's address? No, it generates it internally.
    // Let's just transfer tokens out of the contract without calling the bridge's withdraw.
    // We'll mock auth for the contract itself.
    env.as_contract(&contract_id, || {
        token.transfer(&contract_id, &user, &100);
    });

    // Now balance < net_deposited (400 < 500)
    // Any mutation should fail because of check_invariants
    let result = bridge.try_deposit(&user, &10, &token_addr, &Bytes::new(&env), &0, &0);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

// ── withdrawal cooldown tests ─────────────────────────────────────────────

#[test]
fn test_withdrawal_cooldown_not_triggered_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Set cooldown: 100 ledgers, threshold 500
    bridge.set_withdrawal_cooldown(&100, &500);
    assert_eq!(bridge.get_withdrawal_cooldown(), 100);
    assert_eq!(bridge.get_withdrawal_threshold(), 500);

    // Deposit below threshold — should NOT set LastLargeDeposit
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0);

    // Withdrawal should succeed immediately (no cooldown recorded)
    let req_id = bridge.request_withdrawal(&user, &50, &token_addr);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);
    drop(admin);
}

#[test]
fn test_withdrawal_cooldown_blocks_after_large_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // 100-ledger cooldown, threshold 500
    bridge.set_withdrawal_cooldown(&100, &500);

    // Deposit at or above threshold
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0);

    // Immediate withdrawal request should be blocked
    let result = bridge.try_request_withdrawal(&user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_withdrawal_cooldown_expires() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.set_withdrawal_cooldown(&100, &500);
    let deposit_ledger = env.ledger().sequence();

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0);

    // Still blocked before cooldown expires
    let result = bridge.try_request_withdrawal(&user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));

    // Advance past cooldown
    env.ledger().with_mut(|li| {
        li.sequence_number = deposit_ledger + 100;
    });

    // Now the request should succeed
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(token.balance(&user), 4_600); // 5000 - 500 deposited + 100 withdrawn
}

#[test]
fn test_withdrawal_cooldown_disabled_when_zeroed() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Enable then immediately disable
    bridge.set_withdrawal_cooldown(&100, &500);
    bridge.set_withdrawal_cooldown(&0, &0);

    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0);

    // No cooldown active — withdrawal should go through immediately
    let req_id = bridge.request_withdrawal(&user, &200, &token_addr);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);
}
// ── slippage tests ────────────────────────────────────────────────────────
#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_price(_env: Env, _token: Address) -> Option<i128> {
        // Return 0.95 USD (9,500,000) for testing
        Some(9_500_000)
    }
}

#[test]
fn test_slippage_violation_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    
    let oracle_id = env.register(MockOracle, ());
    bridge.set_oracle(&oracle_id);

    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Expected price is 1.0 USD (10,000_000), actual is 0.95 (500 bps drop)
    // Threshold is 100 bps (1%)
    let expected_price = 10_000_000;
    let max_slippage = 100;

    let result = bridge.try_deposit(&user, &1000, &token_addr, &Bytes::new(&env), &expected_price, &max_slippage);
    assert_eq!(result, Err(Ok(Error::SlippageExceeded)));

    // Now allow it with 600 bps threshold
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &expected_price, &600);
    assert_eq!(token.balance(&user), 4000);
}
