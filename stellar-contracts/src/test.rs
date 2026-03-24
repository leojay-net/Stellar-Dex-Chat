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

    bridge.deposit(&user, &200, &Bytes::new(&env));
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
    bridge.deposit(&user, &200, &Bytes::new(&env));

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
        li.sequence_number = start_ledger + 100;
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
    bridge.deposit(&user, &200, &Bytes::new(&env));

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

    bridge.deposit(&user, &200, &Bytes::new(&env));
    assert_eq!(bridge.get_balance(), 200);
    assert_eq!(bridge.get_total_deposited(), 200);

    bridge.deposit(&user, &100, &Bytes::new(&env));
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

    // Same address, same ledger window → must fail
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

    // Advance past the cooldown window
    env.ledger().with_mut(|li| {
        li.sequence = start_ledger + 7;
    });

    // Should succeed now
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

    // Different address is unaffected by user_a's cooldown
    bridge.deposit(&user_b, &100);

    // user_a still blocked
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

    // Move beyond cooldown TTL so the temporary key naturally expires
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

#[test]
fn test_deposit_and_withdraw_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &Bytes::new(&env));
    let deposit_events = std::format!("{:?}", env.events().all());
    assert!(deposit_events.contains("deposit"));
    assert!(deposit_events.contains("lo: 200"));

    bridge.withdraw(&user, &100);
    let withdraw_events = std::format!("{:?}", env.events().all());
    assert!(withdraw_events.contains("withdraw"));
    assert!(withdraw_events.contains("lo: 100"));
}

// ── error-case tests ──────────────────────────────────────────────────

#[test]
fn test_over_limit_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let result = bridge.try_deposit(&user, &600, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_zero_amount_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);
    let user = Address::generate(&env);

    let result = bridge.try_deposit(&user, &0, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_insufficient_funds_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100, &Bytes::new(&env));

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

// ── Receipt tests ───────────────────────────────────────────────────

#[test]
fn test_deposit_receipt_created() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let ref_bytes = Bytes::from_slice(&env, b"paystack_ref_abc123");
    let receipt_id = bridge.deposit(&user, &200, &ref_bytes);
    assert_eq!(receipt_id, 0);

    let receipt = bridge.get_receipt(&receipt_id).unwrap();
    assert_eq!(receipt.id, 0);
    assert_eq!(receipt.depositor, user);
    assert_eq!(receipt.amount, 200);
    assert_eq!(receipt.reference, ref_bytes);
    assert_eq!(receipt.ledger, env.ledger().sequence());
}

#[test]
fn test_receipt_ids_increment() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &2_000);

    let empty_ref = Bytes::new(&env);
    let id0 = bridge.deposit(&user, &100, &empty_ref);
    let id1 = bridge.deposit(&user, &200, &empty_ref);
    let id2 = bridge.deposit(&user, &50, &empty_ref);

    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(bridge.get_receipt_counter(), 3);
}

#[test]
fn test_reference_stored_exactly() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let ref_data: [u8; 32] = [0xAB; 32];
    let ref_bytes = Bytes::from_slice(&env, &ref_data);
    let id = bridge.deposit(&user, &100, &ref_bytes);

    let receipt = bridge.get_receipt(&id).unwrap();
    assert_eq!(receipt.reference, ref_bytes);
    assert_eq!(receipt.reference.len(), 32);
}

#[test]
fn test_reference_too_long() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let oversized: [u8; 65] = [0xFF; 65];
    let ref_bytes = Bytes::from_slice(&env, &oversized);
    let result = bridge.try_deposit(&user, &100, &ref_bytes);
    assert_eq!(result, Err(Ok(Error::ReferenceTooLong)));
}

#[test]
fn test_reference_at_max_length() {
// ── Allowlist tests ───────────────────────────────────────────────────

#[test]
fn test_allowlist_disabled_anyone_can_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    // Allowlist is off by default – any address can deposit.
    assert!(!bridge.get_allowlist_enabled());
    bridge.deposit(&user, &100, &Bytes::new(&env));
    assert_eq!(token.balance(&user), 900);
}

#[test]
fn test_allowlist_enabled_blocks_unlisted_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let max_ref: [u8; 64] = [0xCC; 64];
    let ref_bytes = Bytes::from_slice(&env, &max_ref);
    let id = bridge.deposit(&user, &100, &ref_bytes);

    let receipt = bridge.get_receipt(&id).unwrap();
    assert_eq!(receipt.reference.len(), 64);
}

#[test]
fn test_empty_reference_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let id = bridge.deposit(&user, &100, &Bytes::new(&env));
    let receipt = bridge.get_receipt(&id).unwrap();
    assert_eq!(receipt.reference.len(), 0);
}

#[test]
fn test_get_receipts_by_depositor() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &5_000);
    token_sac.mint(&user_b, &5_000);

    let empty_ref = Bytes::new(&env);
    bridge.deposit(&user_a, &100, &empty_ref); // id 0
    bridge.deposit(&user_b, &200, &empty_ref); // id 1
    bridge.deposit(&user_a, &300, &empty_ref); // id 2
    bridge.deposit(&user_b, &400, &empty_ref); // id 3
    bridge.deposit(&user_a, &50, &empty_ref);  // id 4

    // Get all of user_a's receipts
    let a_receipts = bridge.get_receipts_by_depositor(&user_a, &0, &10);
    assert_eq!(a_receipts.len(), 3);
    assert_eq!(a_receipts.get(0).unwrap().amount, 100);
    assert_eq!(a_receipts.get(1).unwrap().amount, 300);
    assert_eq!(a_receipts.get(2).unwrap().amount, 50);

    // Paginated: get user_a's receipts starting from id 2
    let a_page2 = bridge.get_receipts_by_depositor(&user_a, &2, &10);
    assert_eq!(a_page2.len(), 2);
    assert_eq!(a_page2.get(0).unwrap().amount, 300);
    assert_eq!(a_page2.get(1).unwrap().amount, 50);

    // Get user_b's receipts with limit
    let b_receipts = bridge.get_receipts_by_depositor(&user_b, &0, &1);
    assert_eq!(b_receipts.len(), 1);
    assert_eq!(b_receipts.get(0).unwrap().amount, 200);
}

#[test]
fn test_receipt_issued_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &Bytes::new(&env));
    let events = std::format!("{:?}", env.events().all());
    assert!(events.contains("receipt_issued"));
}

#[test]
fn test_get_nonexistent_receipt() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);
    assert_eq!(bridge.get_receipt(&999), None);
}

// ── daily withdrawal limit tests ──────────────────────────────────────

/// A single withdrawal call that exceeds the daily limit returns DailyLimitExceeded.
#[test]
fn test_daily_limit_single_call_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &500, &Bytes::new(&env));

    // Daily limit: 100 tokens
    bridge.set_daily_limit(&100);

    let req_id = bridge.request_withdrawal(&user, &200);
    let result = bridge.try_execute_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));
}

/// Multiple withdrawals within the same window that cumulatively exceed
/// the daily limit are correctly blocked.
#[test]
fn test_daily_limit_multi_call_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &500, &Bytes::new(&env));

    // Daily limit: 200 tokens
    bridge.set_daily_limit(&200);

    // First withdrawal of 150 — within the limit.
    let req1 = bridge.request_withdrawal(&user, &150);
    bridge.execute_withdrawal(&req1);

    // Second withdrawal of 100 — 150 + 100 = 250 > 200, should be blocked.
    let req2 = bridge.request_withdrawal(&user, &100);
    let result = bridge.try_execute_withdrawal(&req2);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));

    // Confirm get_window_withdrawn reflects the first withdrawal.
    assert_eq!(bridge.get_window_withdrawn(), 150);
}

/// After the 24-hour window expires the full daily limit is available again.
#[test]
fn test_daily_limit_window_reset() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &600, &Bytes::new(&env));

    bridge.set_daily_limit(&200);

    // Withdraw up to the daily limit.
    let req1 = bridge.request_withdrawal(&user, &200);
    bridge.execute_withdrawal(&req1);
    assert_eq!(bridge.get_window_withdrawn(), 200);
    assert_eq!(bridge.get_window_remaining(), 0);

    // Advance ledger past the window boundary (~17 280 ledgers).
    let start = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 17_280;
    });

    // Window has reset — a new 200-token withdrawal should succeed.
    let req2 = bridge.request_withdrawal(&user, &200);
    bridge.execute_withdrawal(&req2);
    assert_eq!(token.balance(&user), 800); // 400 deposited (net), 400 withdrawn
}

/// Setting the daily limit to 0 disables the cap (backward-compatible default).
#[test]
fn test_daily_limit_zero_disables_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &500, &Bytes::new(&env));

    // Daily limit stays at 0 (default) — large withdrawal must succeed.
    let req_id = bridge.request_withdrawal(&user, &500);
    bridge.execute_withdrawal(&req_id);
    assert_eq!(token.balance(&user), 1_000);

    // Explicitly set to 0 and confirm get_window_remaining returns i128::MAX.
    bridge.set_daily_limit(&0);
    assert_eq!(bridge.get_daily_limit(), 0);
    assert_eq!(bridge.get_window_remaining(), i128::MAX);
}

// ── batch withdrawal tests ────────────────────────────────────────────

/// A batch of 5 valid entries all succeed in one transaction.
#[test]
fn test_batch_withdraw_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token, token_sac) = setup_bridge(&env, 5_000);
    let users: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&env)).collect();
    token_sac.mint(&users[0], &2_000);
    bridge.deposit(&users[0], &2_000, &Bytes::new(&env));

    let mut entries = soroban_sdk::Vec::new(&env);
    for u in &users {
        entries.push_back(WithdrawEntry { to: u.clone(), amount: 100 });
    }

    bridge.batch_withdraw(&entries);

    // Each of the 5 users received 100 tokens.
    for u in &users {
        assert_eq!(token.balance(u), 100);
    }
    // Contract balance reduced by 500.
    assert_eq!(token.balance(&contract_id), 1_500);
}

/// A batch where one entry has a zero amount reverts the entire call.
#[test]
fn test_batch_withdraw_zero_amount_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token, token_sac) = setup_bridge(&env, 1_000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &500);
    bridge.deposit(&user_a, &500, &Bytes::new(&env));

    let mut entries = soroban_sdk::Vec::new(&env);
    entries.push_back(WithdrawEntry { to: user_a.clone(), amount: 100 });
    entries.push_back(WithdrawEntry { to: user_b.clone(), amount: 0 }); // invalid

    let result = bridge.try_batch_withdraw(&entries);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));

    // Balances unchanged.
    assert_eq!(token.balance(&contract_id), 500);
    assert_eq!(token.balance(&user_a), 0); // minted 500, deposited all 500
}

/// A batch whose total exceeds the contract balance reverts entirely.
#[test]
fn test_batch_withdraw_insufficient_balance_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token, token_sac) = setup_bridge(&env, 1_000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &300);
    bridge.deposit(&user_a, &300, &Bytes::new(&env));

    // Total = 200 + 200 = 400 > 300 (contract balance)
    let mut entries = soroban_sdk::Vec::new(&env);
    entries.push_back(WithdrawEntry { to: user_a.clone(), amount: 200 });
    entries.push_back(WithdrawEntry { to: user_b.clone(), amount: 200 });

    let result = bridge.try_batch_withdraw(&entries);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    // Contract balance unchanged.
    assert_eq!(token.balance(&contract_id), 300);
}

/// A batch exceeding MAX_BATCH_SIZE (25) is rejected before any transfers.
#[test]
fn test_batch_withdraw_too_large_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, token, token_sac) = setup_bridge(&env, 100_000);
    let funder = Address::generate(&env);
    token_sac.mint(&funder, &100_000);
    bridge.deposit(&funder, &100_000, &Bytes::new(&env));

    // Build 26 entries — one over the MAX_BATCH_SIZE of 25.
    let mut entries = soroban_sdk::Vec::new(&env);
    for _ in 0..26 {
        let u = Address::generate(&env);
        entries.push_back(WithdrawEntry { to: u, amount: 1 });
    }

    let result = bridge.try_batch_withdraw(&entries);
    assert_eq!(result, Err(Ok(Error::BatchTooLarge)));

    // Contract balance unchanged.
    assert_eq!(token.balance(&contract_id), 100_000);
    bridge.set_allowlist_enabled(&true);
    assert!(bridge.get_allowlist_enabled());

    let result = bridge.try_deposit(&user, &100, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::NotAllowed)));
}

#[test]
fn test_allowlist_add_then_deposit_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_allowlist_enabled(&true);
    bridge.allowlist_add(&user);

    assert!(bridge.is_allowed(&user));
    bridge.deposit(&user, &200, &Bytes::new(&env));
    assert_eq!(token.balance(&user), 800);
}

#[test]
fn test_allowlist_remove_blocks_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_allowlist_enabled(&true);
    bridge.allowlist_add(&user);

    // First deposit succeeds.
    bridge.deposit(&user, &100, &Bytes::new(&env));
    assert_eq!(token.balance(&user), 900);

    // Remove from allowlist – subsequent deposit should fail.
    bridge.allowlist_remove(&user);
    assert!(!bridge.is_allowed(&user));

    let result = bridge.try_deposit(&user, &100, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::NotAllowed)));
}

#[test]
fn test_allowlist_toggle_off_reenables_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    // Enable allowlist – deposit blocked.
    bridge.set_allowlist_enabled(&true);
    let result = bridge.try_deposit(&user, &100, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::NotAllowed)));

    // Disable allowlist – unrestricted deposits resume immediately.
    bridge.set_allowlist_enabled(&false);
    bridge.deposit(&user, &100, &Bytes::new(&env));
    assert_eq!(token.balance(&user), 900);
}

#[test]
fn test_allowlist_batch_add_and_remove() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, token, token_sac) = setup_bridge(&env, 500);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &1_000);
    token_sac.mint(&user_b, &1_000);

    bridge.set_allowlist_enabled(&true);

    // Bulk-add both users.
    let addrs = soroban_sdk::vec![&env, user_a.clone(), user_b.clone()];
    bridge.allowlist_add_batch(&addrs);

    assert!(bridge.is_allowed(&user_a));
    assert!(bridge.is_allowed(&user_b));

    bridge.deposit(&user_a, &100, &Bytes::new(&env));
    bridge.deposit(&user_b, &100, &Bytes::new(&env));
    assert_eq!(token.balance(&user_a), 900);
    assert_eq!(token.balance(&user_b), 900);

    // Bulk-remove both users.
    let remove_addrs = soroban_sdk::vec![&env, user_a.clone(), user_b.clone()];
    bridge.allowlist_remove_batch(&remove_addrs);

    assert!(!bridge.is_allowed(&user_a));
    assert!(!bridge.is_allowed(&user_b));

    let result = bridge.try_deposit(&user_a, &100, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::NotAllowed)));
}
