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
    bridge.init(&admin, &token_addr, &limit);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

// ── happy-path tests ──────────────────────────────────────────────────

#[test]
fn test_deposit_and_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    assert_eq!(token.balance(&user), 800);
    assert_eq!(token.balance(&contract_id), 200);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    bridge.execute_withdrawal(&req_id);

    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

#[test]
fn test_time_locked_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));

    bridge.set_lock_period(&100);
    assert_eq!(bridge.get_lock_period(), 100);

    let start_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);

    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.token, token_addr);
    assert_eq!(req.token, token_addr);
    assert_eq!(req.amount, 100);
    assert_eq!(req.unlock_ledger, start_ledger + 100);

    let result = bridge.try_execute_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

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

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
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

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_balance(), 200);
    assert_eq!(bridge.get_total_deposited(), 200);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_total_deposited(), 300);
}

#[test]
fn test_set_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 100);
    bridge.set_limit(&token_addr, &500);
    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 100);
    bridge.set_limit(&token_addr, &500);
    assert_eq!(bridge.get_limit(), 500);
    bridge.set_limit(&token_addr, &50);
    bridge.set_limit(&token_addr, &50);
    assert_eq!(bridge.get_limit(), 50);
}

#[test]
fn test_set_and_get_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _token_addr, _, _) = setup_bridge(&env, 100);
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

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&10);
    let start_ledger = env.ledger().sequence();

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(bridge.get_last_deposit_ledger(&user), Some(start_ledger));

    // Same address, same ledger window → must fail
    let result = bridge.try_deposit(&user, &50, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_deposit_succeeds_after_cooldown_period() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&7);
    let start_ledger = env.ledger().sequence();

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));

    // Advance past the cooldown window
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 7;
    });

    // Should succeed now
    bridge.deposit(&user, &50, &token_addr, &Bytes::new(&env));
}

#[test]
fn test_deposit_cooldown_is_per_address_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &1_000);
    token_sac.mint(&user_b, &1_000);

    bridge.set_cooldown(&10);

    bridge.deposit(&user_a, &100, &token_addr, &Bytes::new(&env));

    // Different address is unaffected by user_a's cooldown
    bridge.deposit(&user_b, &100, &token_addr, &Bytes::new(&env));

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

    // Move beyond cooldown TTL so the temporary key naturally expires
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 6;
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

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    let deposit_events = std::format!("{:?}", env.events().all());
    assert!(deposit_events.contains("deposit"));
    assert!(deposit_events.contains("lo: 200"));

    bridge.withdraw(&user, &100, &token_addr);
    bridge.withdraw(&user, &100, &token_addr);
    let withdraw_events = std::format!("{:?}", env.events().all());
    assert!(withdraw_events.contains("withdraw"));
    assert!(withdraw_events.contains("lo: 100"));
}

// ── error-case tests ──────────────────────────────────────────────────

#[test]
fn test_over_limit_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let result = bridge.try_deposit(&user, &600, &token_addr, &Bytes::new(&env));
    let result = bridge.try_deposit(&user, &600, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn test_zero_amount_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
    let user = Address::generate(&env);

    let result = bridge.try_deposit(&user, &0, &token_addr, &Bytes::new(&env));
    let result = bridge.try_deposit(&user, &0, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_insufficient_funds_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));

    let req_id = bridge.request_withdrawal(&user, &200, &token_addr);
    let req_id = bridge.request_withdrawal(&user, &200, &token_addr);
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

#[test]
fn test_per_user_deposit_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, token_sac) = setup_bridge(&env, 1000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    token_sac.mint(&user1, &500);
    token_sac.mint(&user2, &500);

    // Initial state
    assert_eq!(bridge.get_user_deposited(&user1), 0);
    assert_eq!(bridge.get_user_deposited(&user2), 0);

    // User1 first deposit
    bridge.deposit(&user1, &100);
    assert_eq!(bridge.get_user_deposited(&user1), 100);
    assert_eq!(bridge.get_total_deposited(), 100);

    // User1 second deposit
    bridge.deposit(&user1, &50);
    assert_eq!(bridge.get_user_deposited(&user1), 150);
    assert_eq!(bridge.get_total_deposited(), 150);

    // User2 first deposit
    bridge.deposit(&user2, &200);
    assert_eq!(bridge.get_user_deposited(&user2), 200);
    assert_eq!(bridge.get_user_deposited(&user1), 150); // user1 stays same
    assert_eq!(bridge.get_total_deposited(), 350);
    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
    assert_eq!(token.balance(&contract_id), 200);

    bridge.remove_token(&token_addr);

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env));
    assert_eq!(result, Err(Ok(Error::TokenNotWhitelisted)));

    let drain_to = Address::generate(&env);
    bridge.withdraw(&drain_to, &200, &token_addr);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&drain_to), 200);
}

// ── Receipt tests ───────────────────────────────────────────────────

#[test]
fn test_deposit_receipt_created() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let ref_bytes = Bytes::from_slice(&env, b"paystack_ref_abc123");
    let receipt_id = bridge.deposit(&user, &200, &token_addr, &ref_bytes);
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

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &2_000);

    let empty_ref = Bytes::new(&env);
    let id0 = bridge.deposit(&user, &100, &token_addr, &empty_ref);
    let id1 = bridge.deposit(&user, &200, &token_addr, &empty_ref);
    let id2 = bridge.deposit(&user, &50, &token_addr, &empty_ref);

    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(bridge.get_receipt_counter(), 3);
}

#[test]
fn test_reference_stored_exactly() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let ref_data: [u8; 32] = [0xAB; 32];
    let ref_bytes = Bytes::from_slice(&env, &ref_data);
    let id = bridge.deposit(&user, &100, &token_addr, &ref_bytes);

    let receipt = bridge.get_receipt(&id).unwrap();
    assert_eq!(receipt.reference, ref_bytes);
    assert_eq!(receipt.reference.len(), 32);
}

#[test]
fn test_reference_too_long() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let oversized: [u8; 65] = [0xFF; 65];
    let ref_bytes = Bytes::from_slice(&env, &oversized);
    let result = bridge.try_deposit(&user, &100, &token_addr, &ref_bytes);
    assert_eq!(result, Err(Ok(Error::ReferenceTooLong)));
}

#[test]
fn test_reference_at_max_length() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let max_ref: [u8; 64] = [0xCC; 64];
    let ref_bytes = Bytes::from_slice(&env, &max_ref);
    let id = bridge.deposit(&user, &100, &token_addr, &ref_bytes);

    let receipt = bridge.get_receipt(&id).unwrap();
    assert_eq!(receipt.reference.len(), 64);
}

#[test]
fn test_empty_reference_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let id = bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
    let receipt = bridge.get_receipt(&id).unwrap();
    assert_eq!(receipt.reference.len(), 0);
}

#[test]
fn test_get_receipts_by_depositor() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &5_000);
    token_sac.mint(&user_b, &5_000);

    let empty_ref = Bytes::new(&env);
    bridge.deposit(&user_a, &100, &token_addr, &empty_ref);
    bridge.deposit(&user_b, &200, &token_addr, &empty_ref);
    bridge.deposit(&user_a, &300, &token_addr, &empty_ref);
    bridge.deposit(&user_b, &400, &token_addr, &empty_ref);
    bridge.deposit(&user_a, &50, &token_addr, &empty_ref);

    let a_receipts = bridge.get_receipts_by_depositor(&user_a, &0, &10);
    assert_eq!(a_receipts.len(), 3);
    assert_eq!(a_receipts.get(0).unwrap().amount, 100);
    assert_eq!(a_receipts.get(1).unwrap().amount, 300);
    assert_eq!(a_receipts.get(2).unwrap().amount, 50);

    let a_page2 = bridge.get_receipts_by_depositor(&user_a, &2, &10);
    assert_eq!(a_page2.len(), 2);
    assert_eq!(a_page2.get(0).unwrap().amount, 300);
    assert_eq!(a_page2.get(1).unwrap().amount, 50);

    let b_receipts = bridge.get_receipts_by_depositor(&user_b, &0, &1);
    assert_eq!(b_receipts.len(), 1);
    assert_eq!(b_receipts.get(0).unwrap().amount, 200);
}

#[test]
fn test_receipt_issued_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
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
