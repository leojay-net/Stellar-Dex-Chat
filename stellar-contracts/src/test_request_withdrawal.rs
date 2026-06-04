//! Comprehensive tests for `request_withdrawal`.
//!
//! Covers all error paths, state mutations, and invariants that the existing
//! proptest and edge-case tests leave unaddressed.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Bytes, BytesN, Env,
};

fn setup(env: &Env) -> (Address, FiatBridgeClient<'_>, Address, Address, StellarAssetClient<'_>) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac = StellarAssetClient::new(env, &token_addr);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);
    bridge.set_limit(&token_addr, &1_000_000i128);
    (contract_id, bridge, admin, token_addr, sac)
}

fn fund_and_deposit(
    bridge: &FiatBridgeClient<'_>,
    sac: &StellarAssetClient<'_>,
    user: &Address,
    token: &Address,
    amount: i128,
) {
    sac.mint(user, &amount);
    bridge.deposit(
        user, &amount, token,
        &Bytes::new(sac.address.env()), &0, &0, &None,
    );
}

// ── Guard / rejection tests ───────────────────────────────────────────────────

#[test]
fn rw_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &0, &token, &None, &0),
        Err(Ok(Error::ZeroAmount))
    );
}

#[test]
fn rw_negative_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &-1, &token, &None, &0),
        Err(Ok(Error::ZeroAmount))
    );
}

#[test]
fn rw_unwhitelisted_token_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _token, _sac) = setup(&env);
    let user = Address::generate(&env);
    let other_admin = Address::generate(&env);
    let other_token = env
        .register_stellar_asset_contract_v2(other_admin)
        .address();
    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &other_token, &None, &0),
        Err(Ok(Error::TokenNotWhitelisted))
    );
}

#[test]
fn rw_contract_as_recipient_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 1_000);
    assert_eq!(
        bridge.try_request_withdrawal(&contract_id, &500, &token, &None, &0),
        Err(Ok(Error::InvalidRecipient))
    );
}

#[test]
fn rw_exceeds_net_deposited_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &501, &token, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
}

#[test]
fn rw_denied_address_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    bridge.deny_address(&user);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &token, &None, &0),
        Err(Ok(Error::AddressDenied))
    );
}

#[test]
fn rw_paused_contract_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    bridge.pause();
    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &token, &None, &0),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn rw_second_request_exceeding_remaining_net_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    bridge.request_withdrawal(&user, &400, &token, &None, &0);
    // 101 more would push liabilities to 501, exceeding 500 net
    assert_eq!(
        bridge.try_request_withdrawal(&user, &101, &token, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
}

#[test]
fn rw_invalid_memo_hash_all_zeros_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    let zero_memo: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &token, &Some(zero_memo), &0),
        Err(Ok(Error::InvalidMemoHash))
    );
}

// ── Happy-path / stored-field tests ──────────────────────────────────────────

#[test]
fn rw_withdraw_cooldown_blocks_request() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 1_000);
    // ledgers=50-ledger window, threshold=100 (deposits >= 100 trigger cooldown)
    bridge.set_withdrawal_cooldown(&50u32, &100i128);
    let current = env.ledger().sequence();
    env.as_contract(&contract_id, || {
        env.storage()
            .temporary()
            .set(&DataKey::LastLargeDeposit(user.clone()), &current);
    });
    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &token, &None, &0),
        Err(Ok(Error::CooldownActive))
    );
}

#[test]
fn rw_first_request_id_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    assert_eq!(bridge.request_withdrawal(&user, &100, &token, &None, &0), 0);
}

#[test]
fn rw_request_ids_increment_monotonically() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);
    assert_eq!(bridge.request_withdrawal(&user, &100, &token, &None, &0), 0);
    assert_eq!(bridge.request_withdrawal(&user, &100, &token, &None, &0), 1);
    assert_eq!(bridge.request_withdrawal(&user, &100, &token, &None, &0), 2);
}

#[test]
fn rw_stored_to_token_amount_fields_match_input() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    let id = bridge.request_withdrawal(&user, &250, &token, &None, &0);
    let req = bridge.get_withdrawal_request(&id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.token, token);
    assert_eq!(req.amount, 250);
}

#[test]
fn rw_queued_ledger_matches_current_sequence() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    env.ledger().with_mut(|li| li.sequence_number = 1_000);
    let id = bridge.request_withdrawal(&user, &100, &token, &None, &0);
    let req = bridge.get_withdrawal_request(&id).unwrap();
    assert_eq!(req.queued_ledger, 1_000);
}

#[test]
fn rw_unlock_ledger_accounts_for_lock_period() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    env.ledger().with_mut(|li| li.sequence_number = 500);
    bridge.set_lock_period(&200u32);
    let id = bridge.request_withdrawal(&user, &100, &token, &None, &0);
    let req = bridge.get_withdrawal_request(&id).unwrap();
    assert_eq!(req.unlock_ledger, 700); // 500 + 200
}

#[test]
fn rw_zero_lock_period_unlock_equals_queued() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    env.ledger().with_mut(|li| li.sequence_number = 42);
    let id = bridge.request_withdrawal(&user, &100, &token, &None, &0);
    let req = bridge.get_withdrawal_request(&id).unwrap();
    assert_eq!(req.unlock_ledger, req.queued_ledger);
}

#[test]
fn rw_valid_memo_hash_stored_correctly() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    let memo: BytesN<32> = BytesN::from_array(&env, &[0xABu8; 32]);
    let id = bridge.request_withdrawal(&user, &100, &token, &Some(memo.clone()), &0);
    assert_eq!(bridge.get_withdrawal_request(&id).unwrap().memo_hash, Some(memo));
}

#[test]
fn rw_none_memo_hash_stored_as_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    let id = bridge.request_withdrawal(&user, &100, &token, &None, &0);
    assert_eq!(bridge.get_withdrawal_request(&id).unwrap().memo_hash, None);
}

#[test]
fn rw_risk_tier_stored_in_request() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);
    for tier in [0u32, 1, 2, 5] {
        let id = bridge.request_withdrawal(&user, &100, &token, &None, &tier);
        assert_eq!(
            bridge.get_withdrawal_request(&id).unwrap().risk_tier,
            tier,
            "wrong tier for request {id}"
        );
    }
}

#[test]
fn rw_exact_net_deposited_amount_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    let id = bridge.request_withdrawal(&user, &500, &token, &None, &0);
    assert_eq!(bridge.get_withdrawal_request(&id).unwrap().amount, 500);
}

// ── Queue / liability accounting tests ───────────────────────────────────────

#[test]
fn rw_liabilities_increase_by_requested_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);
    assert_eq!(bridge.get_total_liabilities(), 0);
    bridge.request_withdrawal(&user, &300, &token, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 300);
    bridge.request_withdrawal(&user, &700, &token, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 1_000);
}

#[test]
fn rw_queue_depth_increments_per_request() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);
    assert_eq!(bridge.get_wq_depth(), 0);
    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 1);
    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 2);
    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 3);
}

#[test]
fn rw_queue_head_set_on_first_and_stable_thereafter() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);

    let r0 = bridge.request_withdrawal(&user, &100, &token, &None, &0);
    let head1: Option<u64> = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::WithdrawQueueHead).unwrap_or(None)
    });
    assert_eq!(head1, Some(r0));

    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    let head2: Option<u64> = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::WithdrawQueueHead).unwrap_or(None)
    });
    assert_eq!(head2, Some(r0), "queue head must not change on second enqueue");
}

#[test]
fn rw_tier_queue_head_set_on_first_per_tier() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);

    let r0 = bridge.request_withdrawal(&user, &100, &token, &None, &2);
    let head: Option<u64> = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::TierQueueHead(2)).unwrap_or(None)
    });
    assert_eq!(head, Some(r0));

    bridge.request_withdrawal(&user, &100, &token, &None, &2);
    let head2: Option<u64> = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::TierQueueHead(2)).unwrap_or(None)
    });
    assert_eq!(head2, Some(r0), "tier head must not change on second enqueue");
}

#[test]
fn rw_tier_queue_len_increments_independently() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 10_000);

    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    bridge.request_withdrawal(&user, &100, &token, &None, &1);

    let len0: u64 = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::TierQueueLen(0)).unwrap_or(0)
    });
    let len1: u64 = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::TierQueueLen(1)).unwrap_or(0)
    });
    assert_eq!(len0, 2);
    assert_eq!(len1, 1);
}

#[test]
fn rw_no_token_transfer_on_request() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 1_000);

    let tc = soroban_sdk::token::Client::new(&env, &token);
    let user_before = tc.balance(&user);
    let contract_before = tc.balance(&contract_id);

    bridge.request_withdrawal(&user, &500, &token, &None, &0);

    assert_eq!(tc.balance(&user), user_before, "user balance changed");
    assert_eq!(tc.balance(&contract_id), contract_before, "contract balance changed");
}

#[test]
fn rw_requests_from_multiple_users_accumulate() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &alice, &token, 1_000);
    fund_and_deposit(&bridge, &sac, &bob, &token, 1_000);
    bridge.request_withdrawal(&alice, &300, &token, &None, &0);
    bridge.request_withdrawal(&bob, &400, &token, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 700);
    assert_eq!(bridge.get_wq_depth(), 2);
}

// ── Persistence / retrieval / event tests ────────────────────────────────────

#[test]
fn rw_request_is_immediately_retrievable() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    let id = bridge.request_withdrawal(&user, &200, &token, &None, &0);
    assert!(bridge.get_withdrawal_request(&id).is_some());
}

#[test]
fn rw_nonexistent_request_returns_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _) = setup(&env);
    assert!(bridge.get_withdrawal_request(&999).is_none());
}

#[test]
fn rw_five_requests_same_user_all_retrievable() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 5_000);
    let ids = [
        bridge.request_withdrawal(&user, &100, &token, &None, &0),
        bridge.request_withdrawal(&user, &100, &token, &None, &0),
        bridge.request_withdrawal(&user, &100, &token, &None, &0),
        bridge.request_withdrawal(&user, &100, &token, &None, &0),
        bridge.request_withdrawal(&user, &100, &token, &None, &0),
    ];
    for id in ids {
        assert!(bridge.get_withdrawal_request(&id).is_some(), "request {id} not found");
    }
}

#[test]
fn rw_withdrawal_requested_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    bridge.request_withdrawal(&user, &100, &token, &None, &0);
    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(events.events().len() > 0, "no events emitted after request");
}

// ── Cooldown cleared / pause-unpause tests ────────────────────────────────────

#[test]
fn rw_request_succeeds_after_cooldown_window_expires() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 1_000);
    bridge.set_withdrawal_cooldown(&50u32, &100i128);

    let start = env.ledger().sequence();
    env.as_contract(&contract_id, || {
        env.storage()
            .temporary()
            .set(&DataKey::LastLargeDeposit(user.clone()), &start);
    });

    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &token, &None, &0),
        Err(Ok(Error::CooldownActive))
    );

    env.ledger().with_mut(|li| li.sequence_number = start + 51);
    assert_eq!(bridge.request_withdrawal(&user, &100, &token, &None, &0), 0);
}

#[test]
fn rw_request_succeeds_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    bridge.pause();
    assert_eq!(
        bridge.try_request_withdrawal(&user, &100, &token, &None, &0),
        Err(Ok(Error::ContractPaused))
    );
    bridge.unpause();
    assert_eq!(bridge.request_withdrawal(&user, &100, &token, &None, &0), 0);
}

// ── Liability ceiling / additional deposit tests ──────────────────────────────

#[test]
fn rw_liability_ceiling_blocks_final_unit() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 1_000);
    bridge.request_withdrawal(&user, &1_000, &token, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 1_000);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &1, &token, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
}

#[test]
fn rw_additional_deposit_enables_further_requests() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token, sac) = setup(&env);
    let user = Address::generate(&env);
    fund_and_deposit(&bridge, &sac, &user, &token, 500);
    bridge.request_withdrawal(&user, &500, &token, &None, &0);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &1, &token, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
    fund_and_deposit(&bridge, &sac, &user, &token, 200);
    let id = bridge.request_withdrawal(&user, &200, &token, &None, &0);
    assert!(bridge.get_withdrawal_request(&id).is_some());
}
