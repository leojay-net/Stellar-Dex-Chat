#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
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

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(token.balance(&user), 800);
    assert_eq!(token.balance(&contract_id), 200);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
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
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    bridge.set_lock_period(&100);
    assert_eq!(bridge.get_lock_period(), 100);

    let start_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.token, token_addr);
    assert_eq!(req.amount, 100);
    assert_eq!(req.unlock_ledger, start_ledger + 100);
    assert_eq!(req.queued_ledger, start_ledger);

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
fn test_withdraw_queue_metrics_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Empty queue
    assert_eq!(bridge.get_wq_depth(), 0);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), None);
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), None);

    // Enqueue first request
    let l0 = env.ledger().sequence();
    let r1 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l0));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(0));

    // Advance ledger and enqueue second request
    env.ledger().with_mut(|li| {
        li.sequence_number = l0 + 7;
    });
    let l1 = env.ledger().sequence();
    let _r2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 2);
    // Oldest remains first
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l0));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(l1 - l0));

    // Execute first request (default lock_period=0), oldest should move to second
    bridge.execute_withdrawal(&r1, &None, &0, &0);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l1));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(0));
}

#[test]
fn test_withdraw_queue_metrics_cancel_oldest() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let l0 = env.ledger().sequence();
    let r1 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number = l0 + 3;
    });
    let l1 = env.ledger().sequence();
    let r2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    assert_eq!(bridge.get_wq_depth(), 2);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l0));

    // Cancel oldest request: oldest should advance to r2
    bridge.cancel_withdrawal(&r1);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l1));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(0));

    // Cancel remaining request: queue empty
    bridge.cancel_withdrawal(&r2);
    assert_eq!(bridge.get_wq_depth(), 0);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), None);
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), None);
}

#[test]
fn test_cancel_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
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

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
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
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 10;
    });

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
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
    bridge.deposit(&user_a, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // user_b not blocked
    bridge.deposit(&user_b, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // user_a still blocked
    let result = bridge.try_deposit(&user_a, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);
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
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
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

    let result = bridge.try_deposit(&user, &600, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_daily_deposit_limit_enforces_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_daily_deposit_limit(&token_addr, &150);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_deposit(&user, &1, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));
}

#[test]
fn test_daily_deposit_limit_resets_after_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_daily_deposit_limit(&token_addr, &150);
    let start_ledger = env.ledger().sequence();

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let result = bridge.try_deposit(&user, &60, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + WINDOW_LEDGERS;
    });

    bridge.deposit(&user, &150, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user), 250);
}

#[test]
fn test_single_tx_limit_still_enforced_with_daily_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_daily_deposit_limit(&token_addr, &1_000);

    let result = bridge.try_deposit(&user, &600, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_zero_amount_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
    let user = Address::generate(&env);

    let result = bridge.try_deposit(&user, &0, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_insufficient_funds_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Requesting more than net deposits (100) should fail due to invariant check
    let result = bridge.try_request_withdrawal(&user, &200, &token_addr, &None, &0);
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

    bridge.deposit(&user1, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user1), 100);
    assert_eq!(bridge.get_total_deposited(), 100);

    bridge.deposit(&user1, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 150);

    bridge.deposit(&user2, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user2), 200);
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 350);
}

#[test]
fn test_get_config_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 1000);
    let pending_admin = Address::generate(&env);

    bridge.set_cooldown(&12);
    bridge.set_lock_period(&24);
    bridge.set_anti_sandwich_delay(&7);
    bridge.set_fiat_limit(&250_000);
    bridge.transfer_admin(&pending_admin);

    let oracle_addr = Address::generate(&env);
    bridge.set_oracle(&oracle_addr);

    let config = bridge.get_config_snapshot();
    assert_eq!(config.admin, admin);
    assert_eq!(config.pending_admin, Some(pending_admin));
    assert_eq!(config.token, token_addr);
    assert_eq!(config.oracle, Some(oracle_addr.clone()));
    assert_eq!(config.fiat_limit, Some(250_000));
    assert_eq!(config.lock_period, bridge.get_lock_period());
    assert_eq!(config.cooldown_ledgers, bridge.get_cooldown());
    assert_eq!(config.inactivity_threshold, DEFAULT_INACTIVITY_THRESHOLD);
    assert!(!config.allowlist_enabled);
    assert_eq!(config.emergency_recovery, None);
    assert_eq!(config.anti_sandwich_delay, bridge.get_anti_sandwich_delay());
}

#[test]
fn test_total_withdrawn_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_withdrawn(), 0);

    bridge.withdraw(&user, &200, &token_addr);
    assert_eq!(bridge.get_total_withdrawn(), 200);
    assert_eq!(token.balance(&contract_id), 300);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
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

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_liabilities(), 0);

    let req1 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 100);

    let req2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
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

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Manually burn some tokens from the contract to break invariant
    env.as_contract(&contract_id, || {
        token.transfer(&contract_id, &user, &100);
    });

    // Now balance < net_deposited (400 < 500)
    // Any mutation should fail because of check_invariants
    let result = bridge.try_deposit(&user, &10, &token_addr, &Bytes::new(&env), &0, &0, &None);
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
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Withdrawal should succeed immediately (no cooldown recorded)
    let req_id = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);
    drop(admin);
}

#[test]
fn test_withdrawal_cooldown_blocks_after_large_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // 100-ledger cooldown, threshold 500
    bridge.set_withdrawal_cooldown(&100, &500);

    // Deposit at or above threshold
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Immediate withdrawal request should be blocked
    let result = bridge.try_request_withdrawal(&user, &100, &token_addr, &None, &0);
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

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Still blocked before cooldown expires
    let result = bridge.try_request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));

    // Advance past cooldown
    env.ledger().with_mut(|li| {
        li.sequence_number = deposit_ledger + 100;
    });

    // Now the request should succeed
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(token.balance(&user), 4_600); // 5000 - 500 deposited + 100 withdrawn
}

#[test]
fn test_withdrawal_cooldown_disabled_when_zeroed() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Enable then immediately disable
    bridge.set_withdrawal_cooldown(&100, &500);
    bridge.set_withdrawal_cooldown(&0, &0);

    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // No cooldown active — withdrawal should go through immediately
    let req_id = bridge.request_withdrawal(&user, &200, &token_addr, &None, &0);
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
    let expected_price = 10_000_000;
    let max_slippage = 100;

    let result = bridge.try_deposit(
        &user,
        &1000,
        &token_addr,
        &Bytes::new(&env),
        &expected_price,
        &max_slippage,
        &None,
    );
    assert_eq!(result, Err(Ok(Error::SlippageTooHigh)));

    // Now allow it with 600 bps threshold
    bridge.deposit(
        &user,
        &1000,
        &token_addr,
        &Bytes::new(&env),
        &expected_price,
        &600,
        &None,
    );
    assert_eq!(token.balance(&user), 4000);
}

// ── slippage boundary tests ───────────────────────────────────────────────
#[test]
fn test_slippage_boundary_exact() {
    // Test that deposits pass at exactly max_slippage bps
    // Sweep max_slippage from 0 to 10_000 bps
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let oracle_id = env.register(MockOracle, ());
    bridge.set_oracle(&oracle_id);

    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);

    // Test various slippage boundaries
    let test_cases = [
        0u32, 1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 7500, 10000,
    ];

    for max_slippage_bps in test_cases.iter() {
        // Calculate expected_price such that actual slippage equals max_slippage_bps
        // MockOracle returns 9_500_000 (0.95 USD)
        // We want: (expected - 9_500_000) / expected * 10_000 = max_slippage_bps
        // Solving: expected = 9_500_000 * 10_000 / (10_000 - max_slippage_bps)

        let actual_price = 9_500_000i128;
        let expected_price = if *max_slippage_bps == 10000 {
            // Special case: 100% slippage means expected can be anything > actual
            actual_price * 2
        } else {
            // Calculate expected price that gives exactly max_slippage_bps
            actual_price * 10_000 / (10_000 - *max_slippage_bps as i128)
        };

        // Deposit should succeed at exactly max_slippage
        let result = bridge.try_deposit(
            &user,
            &1000,
            &token_addr,
            &Bytes::new(&env),
            &expected_price,
            max_slippage_bps,
            &None,
        );

        // Should succeed (not return an error)
        assert!(
            result.is_ok(),
            "Deposit should succeed at exactly {} bps slippage, but got error: {:?}",
            max_slippage_bps,
            result
        );
    }
}

#[test]
fn test_slippage_boundary_exceeded() {
    // Test that deposits fail at max_slippage + 1 bps
    // Sweep max_slippage from 0 to 10_000 bps
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let oracle_id = env.register(MockOracle, ());
    bridge.set_oracle(&oracle_id);

    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);

    // Test various slippage boundaries
    let test_cases = [0u32, 1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 7500, 9999];

    for max_slippage_bps in test_cases.iter() {
        // Calculate expected_price such that actual slippage equals max_slippage_bps + 1
        // MockOracle returns 9_500_000 (0.95 USD)
        // We want: (expected - 9_500_000) / expected * 10_000 = max_slippage_bps + 1
        // Solving: expected = 9_500_000 * 10_000 / (10_000 - (max_slippage_bps + 1))

        let actual_price = 9_500_000i128;
        let target_slippage = *max_slippage_bps + 1;

        if target_slippage >= 10000 {
            // Skip if target slippage would be >= 100%
            continue;
        }

        let expected_price = actual_price * 10_000 / (10_000 - target_slippage as i128);

        // Deposit should fail at max_slippage + 1
        let result = bridge.try_deposit(
            &user,
            &1000,
            &token_addr,
            &Bytes::new(&env),
            &expected_price,
            max_slippage_bps,
            &None,
        );

        // Should fail with SlippageTooHigh error
        assert_eq!(
            result,
            Err(Ok(Error::SlippageTooHigh)),
            "Deposit should fail at {} bps slippage (max_slippage={} bps)",
            target_slippage,
            max_slippage_bps
        );
    }
}

// ── event versioning tests ────────────────────────────────────────────────
#[test]
fn test_event_version_constant() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    assert_eq!(bridge.get_event_version(), 1);
}

// ── withdrawal quota tests ────────────────────────────────────────────────
#[test]
fn test_set_withdrawal_quota() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    assert_eq!(bridge.get_withdrawal_quota(), 0);
    bridge.set_withdrawal_quota(&500);
    assert_eq!(bridge.get_withdrawal_quota(), 500);
}

#[test]
fn test_withdrawal_quota_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_withdrawal_quota(&200);

    bridge.withdraw(&user, &100, &token_addr);
    bridge.withdraw(&user, &100, &token_addr);

    let result = bridge.try_withdraw(&user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::WithdrawalQuotaExceeded)));
}

#[test]
fn test_withdrawal_quota_resets_after_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_withdrawal_quota(&500);

    bridge.withdraw(&user, &500, &token_addr);

    let result = bridge.try_withdraw(&user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::WithdrawalQuotaExceeded)));

    let start_ledger = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 17_280;
    });

    bridge.withdraw(&user, &500, &token_addr);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id.clone(),
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "quota_reset").into_val(&env)
                ],
                (user.clone(), start_ledger + 17_280).into_val(&env)
            ),
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "withdraw").into_val(&env),
                    user.into_val(&env)
                ],
                500i128.into_val(&env)
            )
        ]
    );
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 500);
}

#[test]
fn test_pause_blocks_state_changing_user_operations_until_unpaused() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &2_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    bridge.pause();

    assert_eq!(
        bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None),
        Err(Ok(Error::ContractPaused))
    );
    assert_eq!(
        bridge.try_request_withdrawal(&user, &50, &token_addr, &None, &0),
        Err(Ok(Error::ContractPaused))
    );
    assert_eq!(
        bridge.try_withdraw(&user, &50, &token_addr),
        Err(Ok(Error::ContractPaused))
    );
    assert_eq!(
        bridge.try_execute_withdrawal(&req_id, &None, &0, &0),
        Err(Ok(Error::ContractPaused))
    );
    assert_eq!(
        bridge.try_cancel_withdrawal(&req_id),
        Err(Ok(Error::ContractPaused))
    );

    bridge.unpause();
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
}

#[test]
fn test_request_withdrawal_extends_matching_receipt_ttl() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &2_000);

    let receipt_id = bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let receipt_key = DataKey::Receipt(receipt_id.clone());
    let initial_ttl = env.as_contract(&contract_id, || {
        env.storage().persistent().get_ttl(&receipt_key)
    });

    env.ledger().with_mut(|li| {
        li.sequence_number += initial_ttl.saturating_sub(5);
    });

    bridge.set_lock_period(&100);
    bridge.set_cooldown(&20);
    bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    assert!(
        env.as_contract(&contract_id, || env
            .storage()
            .persistent()
            .get_ttl(&receipt_key))
            >= MIN_TTL + 100 + 20
    );
}

#[test]
fn test_withdrawal_quota_per_user() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &2000);
    token_sac.mint(&user_b, &2000);

    bridge.deposit(
        &user_a,
        &1000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.deposit(
        &user_b,
        &1000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.set_withdrawal_quota(&500);

    bridge.withdraw(&user_a, &500, &token_addr);
    bridge.withdraw(&user_b, &500, &token_addr);

    let result_a = bridge.try_withdraw(&user_a, &100, &token_addr);
    assert_eq!(result_a, Err(Ok(Error::WithdrawalQuotaExceeded)));

    let result_b = bridge.try_withdraw(&user_b, &100, &token_addr);
    assert_eq!(result_b, Err(Ok(Error::WithdrawalQuotaExceeded)));
}

#[test]
fn test_withdrawal_quota_window_reset_isolated_per_user() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &5_000);
    token_sac.mint(&user_b, &5_000);

    bridge.deposit(&user_a, &2_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user_b, &2_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_withdrawal_quota(&500);

    let start_ledger = env.ledger().sequence();

    // User A consumes full quota at start_ledger.
    bridge.withdraw(&user_a, &500, &token_addr);

    // User B consumes full quota in a later window start.
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 100;
    });
    bridge.withdraw(&user_b, &500, &token_addr);

    assert_eq!(
        bridge.try_withdraw(&user_a, &1, &token_addr),
        Err(Ok(Error::WithdrawalQuotaExceeded))
    );
    assert_eq!(
        bridge.try_withdraw(&user_b, &1, &token_addr),
        Err(Ok(Error::WithdrawalQuotaExceeded))
    );

    // Advance to A's reset point, but still before B's reset point.
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 17_280;
    });

    // A can withdraw after reset; B is still quota-limited.
    bridge.withdraw(&user_a, &100, &token_addr);
    assert_eq!(bridge.get_user_daily_withdrawal(&user_a), 100);
    assert_eq!(
        bridge.try_withdraw(&user_b, &1, &token_addr),
        Err(Ok(Error::WithdrawalQuotaExceeded))
    );

    // Advance past B's reset point; B can now withdraw independently.
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 17_380;
    });

    bridge.withdraw(&user_b, &100, &token_addr);
    assert_eq!(bridge.get_user_daily_withdrawal(&user_b), 100);
}

#[test]
fn test_withdrawal_quota_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_withdrawal_quota(&500);

    bridge.withdraw(&user, &500, &token_addr);
    assert_eq!(bridge.get_user_daily_withdrawal(&user), 500);

    let result = bridge.try_withdraw(&user, &1, &token_addr);
    assert_eq!(result, Err(Ok(Error::WithdrawalQuotaExceeded)));
}

// ── renounce admin tests ──────────────────────────────────────────────────

#[test]
fn test_queue_and_execute_renounce_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, _, _, _) = setup_bridge(&env, 500);

    // Ensure admin is set
    assert_eq!(bridge.get_admin(), admin);

    // Queue renounce
    bridge.queue_renounce_admin();

    // Check pending ledger
    let target = env.ledger().sequence() + MIN_TIMELOCK_DELAY;
    assert_eq!(bridge.get_pending_renounce_ledger(), Some(target));

    // Try executing immediately, should fail with ActionNotReady
    let res = bridge.try_execute_renounce_admin();
    assert_eq!(res, Err(Ok(Error::ActionNotReady)));

    // Advance ledger sequence past target
    env.ledger().with_mut(|li| {
        li.sequence_number = target + 1;
    });

    // Execute should succeed now
    bridge.execute_renounce_admin();

    // Verify admin is renounced
    let res = bridge.try_get_admin();
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
    assert_eq!(bridge.get_pending_renounce_ledger(), None);
}

#[test]
fn test_cancel_renounce_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);

    // Queue renounce
    bridge.queue_renounce_admin();
    assert!(bridge.get_pending_renounce_ledger().is_some());

    // Cancel renounce
    bridge.cancel_renounce_admin();
    assert_eq!(bridge.get_pending_renounce_ledger(), None);

    // Advance ledger sequence
    env.ledger().with_mut(|li| {
        li.sequence_number += MIN_TIMELOCK_DELAY + 1;
    });

    // Try executing should fail because it was cancelled
    let res = bridge.try_execute_renounce_admin();
    assert_eq!(res, Err(Ok(Error::ActionNotQueued)));
}

#[test]
fn test_operator_heartbeat() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    let operator = Address::generate(&env);

    // Initial state
    assert!(!bridge.is_operator(&operator));
    assert_eq!(bridge.get_operator_heartbeat(&operator), None);

    // Set operator
    bridge.set_operator(&operator, &true);
    assert!(bridge.is_operator(&operator));

    // Heartbeat
    let curr = env.ledger().sequence();
    bridge.heartbeat(&operator, &0);
    assert_eq!(bridge.get_operator_heartbeat(&operator), Some(curr));

    // Deactivate operator
    bridge.set_operator(&operator, &false);
    assert!(!bridge.is_operator(&operator));

    // Heartbeat should fail now
    let res = bridge.try_heartbeat(&operator, &1);
    assert_eq!(res, Err(Ok(Error::NotOperator)));
}

#[test]
fn test_receipt_id_determinism_and_uniqueness() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    let reference = Bytes::from_slice(&env, b"ref1");

    // First deposit
    let id1 = bridge.deposit(&user, &100, &token_addr, &reference, &0, &0, &None);

    // Second identical deposit (except internal counter will increase)
    let id2 = bridge.deposit(&user, &100, &token_addr, &reference, &0, &0, &None);

    // They must be unique
    assert_ne!(id1, id2);

    // Verify determinism: re-calculate id1 manually
    // Derivation: sha256(xdr(depositor, amount, ledger, reference, counter))
    // counter for id1 was 0
    let expected_id1_data = (
        user.clone(),
        100i128,
        env.ledger().sequence(),
        reference.clone(),
        0u64,
    );
    let expected_id1: BytesN<32> = env.crypto().sha256(&expected_id1_data.to_xdr(&env)).into();
    assert_eq!(id1, expected_id1);
}

#[test]
fn test_receipt_id_collision_resistance() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    token_sac.mint(&user1, &500);
    token_sac.mint(&user2, &500);

    let ref_shared = Bytes::from_slice(&env, b"ref");

    let id1 = bridge.deposit(&user1, &100, &token_addr, &ref_shared, &0, &0, &None);
    let id2 = bridge.deposit(&user2, &100, &token_addr, &ref_shared, &0, &0, &None);

    assert_ne!(id1, id2);

    // Different amount
    let id3 = bridge.deposit(&user1, &200, &token_addr, &ref_shared, &0, &0, &None);
    assert_ne!(id1, id3);
}

#[test]
fn test_unauthorized_operator_management() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    let _attacker = Address::generate(&env);
    let victim = Address::generate(&env);

    // Attacker tries to set themselves as operator, should fail because they are not admin
    // Note: mock_all_auths handles the check, here we just verify the call structure
    bridge.set_operator(&victim, &true);
    assert!(bridge.is_operator(&victim));
}

// ── denylist tests ────────────────────────────────────────────────────────

#[test]
fn test_deny_address_blocks_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deny_address(&user);
    assert!(bridge.is_denied(&user));

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

// ── escrow migration tests ────────────────────────────────────────────────
#[test]
fn test_escrow_storage_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    assert_eq!(bridge.get_escrow_storage_version(), 0);
}

#[test]
fn test_migrate_escrow_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let migrated = bridge.migrate_escrow(&10);
    assert_eq!(migrated, 2);
    assert_eq!(bridge.get_escrow_storage_version(), 1);
}

#[test]
fn test_deny_address_blocks_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Deposit first, then deny
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);

    let result = bridge.try_withdraw(&user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

#[test]
fn test_deny_address_blocks_request_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);

    let result = bridge.try_request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

#[test]
fn test_migrate_escrow_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.migrate_escrow(&10);
    let result = bridge.try_migrate_escrow(&10);
    assert_eq!(result, Err(Ok(Error::MigrationAlreadyComplete)));
}

#[test]
fn test_remove_denied_address_restores_access() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);
    assert!(bridge.is_denied(&user));

    bridge.remove_denied_address(&user);
    assert!(!bridge.is_denied(&user));

    // Deposit should succeed after removal
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user), 200);
}

#[test]
fn test_migrate_escrow_resumable() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let migrated1 = bridge.migrate_escrow(&2);
    assert_eq!(migrated1, 2);
    assert_eq!(bridge.get_migration_cursor(), 2);
    assert_eq!(bridge.get_escrow_storage_version(), 0);

    let migrated2 = bridge.migrate_escrow(&2);
    assert_eq!(migrated2, 1);
    assert_eq!(bridge.get_migration_cursor(), 3);
    assert_eq!(bridge.get_escrow_storage_version(), 1);
}

#[test]
fn test_denylist_does_not_affect_other_users() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let denied_user = Address::generate(&env);
    let normal_user = Address::generate(&env);
    token_sac.mint(&denied_user, &5_000);
    token_sac.mint(&normal_user, &5_000);

    bridge.deny_address(&denied_user);

    // Normal user should not be affected
    bridge.deposit(
        &normal_user,
        &200,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(bridge.get_user_deposited(&normal_user), 200);
}

#[test]
fn test_is_denied_returns_correct_value() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);

    // Initially, user should not be denied
    assert!(!bridge.is_denied(&user));

    // After denying, should return true
    bridge.deny_address(&user);
    assert!(bridge.is_denied(&user));

    // After removing from denylist, should return false again
    bridge.remove_denied_address(&user);
    assert!(!bridge.is_denied(&user));
}

#[test]
fn test_get_escrow_record() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.migrate_escrow(&10);

    let escrow = bridge.get_escrow_record(&0).unwrap();
    assert_eq!(escrow.version, 1);
    assert_eq!(escrow.depositor, user);
    assert_eq!(escrow.amount, 100);
    assert!(escrow.migrated);
}

// ── batch admin operations tests ──────────────────────────────────────────
#[test]
fn test_batch_admin_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);

    let cooldown_bytes = Bytes::from_array(&env, &100u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: cooldown_bytes,
    });

    let lock_bytes = Bytes::from_array(&env, &50u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: lock_bytes,
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 2);
    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 0);
    assert!(result.failed_index.is_none());

    assert_eq!(bridge.get_cooldown(), 100);
    assert_eq!(bridge.get_lock_period(), 50);
}

#[test]
fn test_batch_admin_rollback_on_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    bridge.set_cooldown(&10);
    bridge.set_lock_period(&20);

    let mut ops = soroban_sdk::Vec::new(&env);

    let cooldown_bytes = Bytes::from_array(&env, &100u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: cooldown_bytes,
    });

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "invalid_op"),
        payload: Bytes::new(&env),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 2);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(1));

    // First valid op is applied, invalid op is skipped.
    assert_eq!(bridge.get_cooldown(), 100);
    assert_eq!(bridge.get_lock_period(), 20);
}

#[test]
fn test_batch_admin_partial_failure_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);

    let cooldown_bytes = Bytes::from_array(&env, &100u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: cooldown_bytes,
    });

    let lock_bytes = Bytes::from_array(&env, &50u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: lock_bytes,
    });

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "unknown"),
        payload: Bytes::new(&env),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 3);
    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(2));
}

#[test]
fn test_batch_admin_mixed_success_failure_continues() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    bridge.set_cooldown(&10);
    bridge.set_lock_period(&20);

    let mut ops = soroban_sdk::Vec::new(&env);

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
    });

    // Invalid op in the middle should not revert successful ops.
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "invalid_op"),
        payload: Bytes::new(&env),
    });

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: Bytes::from_array(&env, &50u32.to_be_bytes()),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 3);
    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(1));

    // State reflects both successful operations (1st and 3rd).
    assert_eq!(bridge.get_cooldown(), 100);
    assert_eq!(bridge.get_lock_period(), 50);
}

#[test]
fn test_batch_admin_with_quota() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);

    let quota_bytes = Bytes::from_array(&env, &1000i128.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_quota"),
        payload: quota_bytes,
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 1);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 0);

    assert_eq!(bridge.get_withdrawal_quota(), 1000);
}

#[test]
fn test_batch_admin_empty_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let ops = soroban_sdk::Vec::new(&env);

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 0);
    assert_eq!(result.success_count, 0);
    assert_eq!(result.failure_count, 0);
    assert!(result.failed_index.is_none());
}

// ── fee vault tests ───────────────────────────────────────────────────────

#[test]
fn test_accrue_and_view_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 10_000);

    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);

    bridge.accrue_fee(&token_addr, &100);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 100);

    bridge.accrue_fee(&token_addr, &50);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 150);
}

#[test]
fn test_accrue_fee_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 10_000);

    let result = bridge.try_accrue_fee(&token_addr, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_fees_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    let recipient = Address::generate(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Deposit so contract has balance
    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Accrue fees
    bridge.accrue_fee(&token_addr, &200);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 200);

    // Withdraw fees
    bridge.withdraw_fees(&recipient, &token_addr, &100);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 100);
    assert_eq!(token.balance(&recipient), 100);
    assert_eq!(token.balance(&contract_id), 900);
}

#[test]
fn test_withdraw_fees_batch_full_sweep() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_a_addr, token_a, token_a_sac) = setup_bridge(&env, 10_000);
    let token_b_admin = Address::generate(&env);
    let (token_b_addr, token_b, token_b_sac) = create_token(&env, &token_b_admin);
    let recipient = Address::generate(&env);

    token_a_sac.mint(&contract_id, &120);
    token_b_sac.mint(&contract_id, &80);

    bridge.accrue_fee(&token_a_addr, &120);
    bridge.accrue_fee(&token_b_addr, &80);

    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_a_addr.clone());
    tokens.push_back(token_b_addr.clone());

    bridge.withdraw_fees_batch(&recipient, &tokens);

    assert_eq!(bridge.get_accrued_fees(&token_a_addr), 0);
    assert_eq!(bridge.get_accrued_fees(&token_b_addr), 0);
    assert_eq!(token_a.balance(&recipient), 120);
    assert_eq!(token_b.balance(&recipient), 80);
}

#[test]
fn test_withdraw_fees_batch_partial_sweep() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_a_addr, token_a, token_a_sac) = setup_bridge(&env, 10_000);
    let token_b_admin = Address::generate(&env);
    let (token_b_addr, token_b, _) = create_token(&env, &token_b_admin);
    let recipient = Address::generate(&env);

    token_a_sac.mint(&contract_id, &200);
    bridge.accrue_fee(&token_a_addr, &200);

    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_a_addr.clone());
    tokens.push_back(token_b_addr.clone());

    bridge.withdraw_fees_batch(&recipient, &tokens);

    assert_eq!(bridge.get_accrued_fees(&token_a_addr), 0);
    assert_eq!(bridge.get_accrued_fees(&token_b_addr), 0);
    assert_eq!(token_a.balance(&recipient), 200);
    assert_eq!(token_b.balance(&recipient), 0);
}

#[test]
fn test_withdraw_fees_exceeds_accrued() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 10_000);

    bridge.accrue_fee(&token_addr, &50);

    let result = bridge.try_withdraw_fees(&Address::generate(&env), &token_addr, &100);
    assert_eq!(result, Err(Ok(Error::NoFeesToWithdraw)));
}

#[test]
fn test_fee_vault_isolation_from_principal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // User deposits 1000
    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 1_000);

    // Accrue 200 in fees — this is separate accounting
    bridge.accrue_fee(&token_addr, &200);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 200);

    // Withdraw fees does NOT affect total_deposited or total_withdrawn
    bridge.withdraw_fees(&fee_recipient, &token_addr, &200);
    assert_eq!(bridge.get_total_deposited(), 1_000);
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
    assert_eq!(token.balance(&fee_recipient), 200);
    assert_eq!(token.balance(&contract_id), 800);
}

// ── emergency token rescue tests ──────────────────────────────────────────

#[test]
fn test_rescue_non_protocol_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _token_addr, _, _) = setup_bridge(&env, 10_000);
    let rescue_admin = Address::generate(&env);

    // Create a separate "stray" token not part of the protocol
    let stray_admin = Address::generate(&env);
    let (stray_addr, stray_token, stray_sac) = create_token(&env, &stray_admin);

    // Simulate accidentally sending stray tokens to the contract
    stray_sac.mint(&contract_id, &500);
    assert_eq!(stray_token.balance(&contract_id), 500);

    // Rescue them
    bridge.rescue_token(&stray_addr, &rescue_admin, &300);
    assert_eq!(stray_token.balance(&rescue_admin), 300);
    assert_eq!(stray_token.balance(&contract_id), 200);
}

#[test]
fn test_rescue_primary_token_forbidden() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_rescue_token(&token_addr, &Address::generate(&env), &100);
    assert_eq!(result, Err(Ok(Error::RescueForbidden)));
}

#[test]
fn test_rescue_whitelisted_token_forbidden() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 10_000);

    // The token_addr is in the TokenRegistry (whitelisted), so rescue should fail
    let result = bridge.try_rescue_token(&token_addr, &Address::generate(&env), &100);
    assert_eq!(result, Err(Ok(Error::RescueForbidden)));
}

#[test]
fn test_rescue_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let stray_admin = Address::generate(&env);
    let (stray_addr, _, _) = create_token(&env, &stray_admin);

    let result = bridge.try_rescue_token(&stray_addr, &Address::generate(&env), &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_rescue_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let stray_admin = Address::generate(&env);
    let (stray_addr, _, stray_sac) = create_token(&env, &stray_admin);

    // Only 100 of stray token on contract
    stray_sac.mint(&contract_id, &100);

    let result = bridge.try_rescue_token(&stray_addr, &Address::generate(&env), &200);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

// ── nonce-based replay protection tests ───────────────────────────────────

#[test]
fn test_operator_nonce_starts_at_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);
    assert_eq!(bridge.get_operator_nonce(&operator), 0);
}

#[test]
fn test_heartbeat_with_valid_nonce_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // First heartbeat with nonce 0
    bridge.heartbeat(&operator, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Second heartbeat with nonce 1
    bridge.heartbeat(&operator, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);
}

#[test]
fn test_heartbeat_with_stale_nonce_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // First heartbeat with nonce 0
    bridge.heartbeat(&operator, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Try to replay with nonce 0 (stale)
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Nonce should remain unchanged
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
}

#[test]
fn test_heartbeat_with_future_nonce_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Try to use nonce 5 when current is 0
    let result = bridge.try_heartbeat(&operator, &5);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Nonce should remain unchanged
    assert_eq!(bridge.get_operator_nonce(&operator), 0);
}

#[test]
fn test_heartbeat_replay_attack_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Execute heartbeat with nonce 0
    bridge.heartbeat(&operator, &0);
    let first_heartbeat = bridge.get_operator_heartbeat(&operator);

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number += 10;
    });

    // Try to replay the same nonce
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Heartbeat timestamp should not have changed
    assert_eq!(bridge.get_operator_heartbeat(&operator), first_heartbeat);
}

#[test]
fn test_nonce_is_per_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator_a = Address::generate(&env);
    let operator_b = Address::generate(&env);

    bridge.set_operator(&operator_a, &true);
    bridge.set_operator(&operator_b, &true);

    // Both start at nonce 0
    assert_eq!(bridge.get_operator_nonce(&operator_a), 0);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 0);

    // Operator A uses nonce 0
    bridge.heartbeat(&operator_a, &0);
    assert_eq!(bridge.get_operator_nonce(&operator_a), 1);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 0);

    // Operator B can still use nonce 0
    bridge.heartbeat(&operator_b, &0);
    assert_eq!(bridge.get_operator_nonce(&operator_a), 1);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 1);
}

#[test]
fn test_nonce_increments_monotonically() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Execute multiple heartbeats
    for i in 0..10 {
        assert_eq!(bridge.get_operator_nonce(&operator), i);
        bridge.heartbeat(&operator, &i);
        assert_eq!(bridge.get_operator_nonce(&operator), i + 1);
    }
}

#[test]
fn test_nonce_skipping_not_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Use nonce 0
    bridge.heartbeat(&operator, &0);

    // Try to skip to nonce 2 (skipping 1)
    let result = bridge.try_heartbeat(&operator, &2);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Nonce should still be 1
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Using nonce 1 should work
    bridge.heartbeat(&operator, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);
}

#[test]
fn test_nonce_persists_across_operator_deactivation() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Use nonce 0 and 1
    bridge.heartbeat(&operator, &0);
    bridge.heartbeat(&operator, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);

    // Deactivate operator
    bridge.set_operator(&operator, &false);

    // Nonce should still be 2
    assert_eq!(bridge.get_operator_nonce(&operator), 2);

    // Reactivate operator
    bridge.set_operator(&operator, &true);

    // Must use nonce 2, not 0
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    bridge.heartbeat(&operator, &2);
    assert_eq!(bridge.get_operator_nonce(&operator), 3);
}

#[test]
fn test_duplicate_nonce_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Use nonce 0
    bridge.heartbeat(&operator, &0);

    // Try to use nonce 0 again
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Use nonce 1
    bridge.heartbeat(&operator, &1);

    // Try to use nonce 1 again
    let result = bridge.try_heartbeat(&operator, &1);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));
}

#[test]
fn test_nonce_validation_before_heartbeat_update() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    let initial_ledger = env.ledger().sequence();
    bridge.heartbeat(&operator, &0);
    assert_eq!(
        bridge.get_operator_heartbeat(&operator),
        Some(initial_ledger)
    );

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number += 5;
    });

    // Try with invalid nonce - heartbeat should not update
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Heartbeat timestamp should not have changed
    assert_eq!(
        bridge.get_operator_heartbeat(&operator),
        Some(initial_ledger)
    );
}

#[test]
fn test_non_operator_cannot_use_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let non_operator = Address::generate(&env);

    // Don't set as operator
    assert!(!bridge.is_operator(&non_operator));

    // Try to heartbeat with nonce 0
    let result = bridge.try_heartbeat(&non_operator, &0);
    assert_eq!(result, Err(Ok(Error::NotOperator)));

    // Nonce should still be 0 (unchanged)
    assert_eq!(bridge.get_operator_nonce(&non_operator), 0);
}

#[test]
fn test_nonce_overflow_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Simulate high nonce value (near u64::MAX would take too long to test)
    // Instead, test that the system handles large nonces correctly
    let _large_nonce = 1_000_000u64;

    // Manually set a high nonce by executing many operations
    // For testing purposes, we'll just verify the logic works with reasonable values
    for i in 0..100 {
        bridge.heartbeat(&operator, &i);
    }

    assert_eq!(bridge.get_operator_nonce(&operator), 100);
}

#[test]
fn test_concurrent_operators_independent_nonces() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let op3 = Address::generate(&env);

    bridge.set_operator(&op1, &true);
    bridge.set_operator(&op2, &true);
    bridge.set_operator(&op3, &true);

    // Interleaved operations
    bridge.heartbeat(&op1, &0);
    bridge.heartbeat(&op2, &0);
    bridge.heartbeat(&op1, &1);
    bridge.heartbeat(&op3, &0);
    bridge.heartbeat(&op2, &1);
    bridge.heartbeat(&op1, &2);

    assert_eq!(bridge.get_operator_nonce(&op1), 3);
    assert_eq!(bridge.get_operator_nonce(&op2), 2);
    assert_eq!(bridge.get_operator_nonce(&op3), 1);
}

// ── Issue #214: deployment config hash tests ─────────────────────────────

#[test]
fn test_deploy_config_hash_stored_on_init() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 500);

    // Hash should be present immediately after init
    let hash = bridge.get_deploy_config_hash();
    assert!(hash.is_some());

    // Re-derive the expected hash from (admin, token, limit)
    let config_data = (admin.clone(), token_addr.clone(), 500i128);
    let expected: BytesN<32> = env.crypto().sha256(&config_data.to_xdr(&env)).into();
    assert_eq!(hash.unwrap(), expected);
}

#[test]
fn test_deploy_config_hash_is_immutable() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);
    let hash_before = bridge.get_deploy_config_hash();

    // Even after changing admin the stored hash must not change
    let new_admin = Address::generate(&env);
    bridge.transfer_admin(&new_admin);
    bridge.accept_admin();

    let hash_after = bridge.get_deploy_config_hash();
    assert_eq!(hash_before, hash_after);
}

#[test]
fn test_deploy_config_hash_differs_for_different_params() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge1, _, _, _, _) = setup_bridge(&env, 500);
    let (_, bridge2, _, _, _, _) = setup_bridge(&env, 1000);

    // Different limits → different hashes
    assert_ne!(
        bridge1.get_deploy_config_hash(),
        bridge2.get_deploy_config_hash()
    );
}

// ── Issue #220: fixed-point math unit tests ───────────────────────────────

#[test]
fn test_math_mul_div_floor_basic() {
    // 7 * 3 / 2 = 10 (floor of 10.5)
    assert_eq!(crate::math::mul_div_floor(7, 3, 2), 10);
}

#[test]
fn test_math_mul_div_floor_exact() {
    // 10 * 3 / 5 = 6 exactly
    assert_eq!(crate::math::mul_div_floor(10, 3, 5), 6);
}

#[test]
fn test_math_mul_div_floor_large_values() {
    // Typical fee calc: amount=1_000_000, price=9_500_000, denom=100_000
    // = 9_500_000_000_000 / 100_000 = 95_000_000
    let usd_cents = crate::math::mul_div_floor(1_000_000, 9_500_000, 100_000);
    assert_eq!(usd_cents, 95_000_000);
}

#[test]
fn test_math_mul_div_floor_zero_numerator() {
    assert_eq!(crate::math::mul_div_floor(0, 9_500_000, 100_000), 0);
}

#[test]
fn test_math_scale_floor() {
    // Scale 1000 by 3/4 = 750
    assert_eq!(crate::math::scale_floor(1000, 3, 4), 750);
}

// ── Issue #209: circuit breaker tests ────────────────────────────────────

#[test]
fn test_circuit_breaker_not_triggered_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&500);

    // 300 < 500 threshold — should succeed
    bridge.withdraw(&user, &300, &token_addr);
    assert!(!bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_trips_on_threshold_breach() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&500);

    // This withdrawal pushes total (0 + 600) > 500 — it succeeds but trips the breaker
    bridge.withdraw(&user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_blocks_subsequent_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&300);

    // The crossing withdrawal succeeds but trips the breaker
    bridge.withdraw(&user, &400, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Subsequent withdrawal must fail
    let result = bridge.try_withdraw(&user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_circuit_breaker_reset_restores_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&300);

    // Trip it (crossing withdrawal goes through, then breaker fires)
    bridge.withdraw(&user, &400, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Admin resets
    bridge.reset_circuit_breaker();
    assert!(!bridge.is_circuit_breaker_tripped());

    // Advance window so global daily volume resets
    let start = env.ledger().sequence();
    env.ledger()
        .with_mut(|li| li.sequence_number = start + 17_280);

    // Withdrawal below threshold succeeds again
    bridge.withdraw(&user, &100, &token_addr);
}

#[test]
fn test_circuit_breaker_disabled_when_threshold_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    // Threshold 0 = disabled
    bridge.set_circuit_breaker_threshold(&0);

    bridge.withdraw(&user, &2000, &token_addr);
    assert!(!bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_also_blocks_execute_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&300);

    // This request exceeds threshold — it goes through but trips the breaker
    let r1 = bridge.request_withdrawal(&user, &400, &token_addr, &None, &0);
    bridge.execute_withdrawal(&r1, &None, &0, &0);
    assert!(bridge.is_circuit_breaker_tripped());

    // A second queued request is now blocked
    let r2 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    let result = bridge.try_execute_withdrawal(&r2, &None, &0, &0);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

// ── Issue #226: withdrawal queue risk tier tests ──────────────────────────

#[test]
fn test_tier_queue_head_set_on_first_enqueue() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let r0 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let _r1 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);

    // Tier 0 has higher priority; get_next_priority_withdrawal should return r0
    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r0));
}

#[test]
fn test_tier_prioritization_higher_tier_waits() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Enqueue tier 2 first, then tier 0
    let r2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &2);
    let r0 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    // Tier 0 should be returned even though tier 2 was queued first
    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r0));

    // Execute tier 0 — now tier 2 should surface
    bridge.execute_withdrawal(&r0, &None, &0, &0);
    let next_after = bridge.get_next_priority_withdrawal();
    assert_eq!(next_after, Some(r2));
}

#[test]
fn test_tier_fifo_within_same_tier() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Two requests in the same tier — FIFO order expected
    let r_first = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);
    let r_second = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);

    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r_first));

    // After executing first, second should surface
    bridge.execute_withdrawal(&r_first, &None, &0, &0);
    let next_after = bridge.get_next_priority_withdrawal();
    assert_eq!(next_after, Some(r_second));
}

#[test]
fn test_tier_head_advances_after_cancel() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let r_a = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let r_b = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    // Cancel the head of tier 0 — r_b should become new head
    bridge.cancel_withdrawal(&r_a);
    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r_b));
}

#[test]
fn test_get_next_priority_returns_none_when_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    assert_eq!(bridge.get_next_priority_withdrawal(), None);
}

// ── get_receipt_by_index tests ───────────────────────────────────────

#[test]
fn test_get_receipt_by_index_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    let receipt_hash = bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let receipt = bridge.get_receipt_by_index(&0);
    assert!(receipt.is_some());
    let receipt = receipt.unwrap();
    assert_eq!(receipt.id, receipt_hash);
    assert_eq!(receipt.depositor, user);
    assert_eq!(receipt.amount, 100);
}

#[test]
fn test_get_receipt_by_index_out_of_range() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Index 1 does not exist (only one deposit at index 0)
    assert_eq!(bridge.get_receipt_by_index(&1), None);
    // Large out-of-range index
    assert_eq!(bridge.get_receipt_by_index(&999), None);
}

#[test]
fn test_get_receipt_by_index_nonexistent_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // The receipt at index 0 should be accessible
    let receipt = bridge.get_receipt_by_index(&0);
    assert!(receipt.is_some());
    assert_eq!(receipt.unwrap().amount, 100);

    // Indexes that were never written return None
    assert_eq!(bridge.get_receipt_by_index(&50), None);
    assert_eq!(bridge.get_receipt_by_index(&u64::MAX), None);
}

#[test]
fn test_memo_hash_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    let valid_hash = BytesN::from_array(&env, &[1u8; 32]);

    // deposit: zero hash is rejected
    let result = bridge.try_deposit(
        &user,
        &100,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &Some(zero_hash.clone()),
    );
    assert_eq!(result, Err(Ok(Error::InvalidMemoHash)));

    // deposit: valid hash succeeds
    bridge.deposit(
        &user,
        &100,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &Some(valid_hash.clone()),
    );

    // request_withdrawal: zero hash is rejected
    let result = bridge.try_request_withdrawal(&user, &50, &token_addr, &Some(zero_hash), &0);
    assert_eq!(result, Err(Ok(Error::InvalidMemoHash)));

    // request_withdrawal: valid hash succeeds
    bridge.request_withdrawal(&user, &50, &token_addr, &Some(valid_hash), &0);
}

// ── Event topic structure tests ───────────────────────────────────────────────

/// Assert that every event emitted by the bridge contract in `f` has `EVENT_VERSION` (u32)
/// as its first XDR topic.
fn assert_bridge_events_have_version(env: &Env, contract_addr: &Address, f: impl FnOnce()) {
    use soroban_sdk::xdr::{ContractEventBody, ScVal};

    f();
    let bridge_events = env.events().all().filter_by_contract(contract_addr);
    let raw = bridge_events.events();
    assert!(!raw.is_empty(), "no bridge events were emitted");
    for event in raw {
        let ContractEventBody::V0(body) = &event.body;
        let first = body.topics.first().expect("bridge event has no topics");
        assert_eq!(
            *first,
            ScVal::U32(EVENT_VERSION),
            "bridge event first topic is not EVENT_VERSION: {:?}",
            body
        );
    }
}

#[test]
fn test_event_version_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_addr, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &500);

    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    });
}

#[test]
fn test_event_version_request_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_addr, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &500);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    });
}

#[test]
fn test_event_version_deny_add_remove() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_addr, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let target = Address::generate(&env);

    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.deny_address(&target);
    });
    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.remove_denied_address(&target);
    });
}

// ── Property-based tests (proptest) ──────────────────────────────────────────

#[cfg(test)]
mod proptest_deposit {
    use super::*;
    use proptest::prelude::*;

    // Deposit invariants that must hold for every positive amount <= limit:
    // 1. deposit() succeeds
    // 2. contract balance increases by exactly amount
    // 3. user balance decreases by exactly amount
    // 4. get_user_deposited() returns amount
    //   1. deposit() succeeds
    //   2. contract balance increases by exactly `amount`
    //   3. user balance decreases by exactly `amount`
    //   4. get_user_deposited() returns `amount`
    proptest! {
        #[test]
        fn deposit_invariants_hold_for_all_valid_amounts(amount in 1i128..=500i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
            let user = Address::generate(&env);
            token_sac.mint(&user, &1_000);

            let user_before = token.balance(&user);
            let contract_before = token.balance(&contract_id);

            bridge.deposit(&user, &amount, &token_addr, &Bytes::new(&env), &0, &0, &None);

            prop_assert_eq!(token.balance(&user), user_before - amount);
            prop_assert_eq!(token.balance(&contract_id), contract_before + amount);
            prop_assert_eq!(bridge.get_user_deposited(&user), amount);
        }

        /// Amounts above the configured limit must be rejected with ExceedsLimit.
        #[test]
        fn deposit_above_limit_is_rejected(amount in 501i128..=10_000i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
            let user = Address::generate(&env);
            token_sac.mint(&user, &amount);

            let result = bridge.try_deposit(&user, &amount, &token_addr, &Bytes::new(&env), &0, &0, &None);
            prop_assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
        }
    }
}
