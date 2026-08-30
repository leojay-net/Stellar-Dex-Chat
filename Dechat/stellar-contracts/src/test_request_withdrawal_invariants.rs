//! Invariant tests for [`FiatBridge::request_withdrawal`].
//!
//! `request_withdrawal` is the only way funds enter the withdrawal queue. It
//! reserves a liability against the token's `TokenConfig`, allocates a
//! monotonically increasing `request_id`, and files the request into both the
//! global FIFO queue and its risk-tier queue. The invariants asserted here
//! are:
//!
//! * **The three core accounting invariants survive every accepted request** —
//!   `total_deposited >= total_withdrawn`,
//!   `net_deposited >= total_liabilities`, and
//!   on-chain `balance >= net_deposited` — the same three
//!   [`FiatBridge::check_invariants`] enforces at runtime.
//! * **Liabilities move by exactly the requested amount**, never more, never
//!   less, and never above the net deposited balance.
//! * **Ids are allocated once, in order, and never reused.** The returned id
//!   is the pre-call `next_request_id`, ids increase by exactly one per
//!   accepted request, and a rejected request consumes none.
//! * **The stored request reflects the caller's inputs faithfully** —
//!   recipient, token, amount, memo hash and risk tier verbatim, with
//!   `queued_ledger` at the current sequence and
//!   `unlock_ledger = queued_ledger + lock_period`.
//! * **Queue depth grows by exactly one** per accepted request, and the
//!   request is reachable through the tier scheduler.
//! * **Failure paths do not partially mutate storage.** This matters more here
//!   than anywhere else in the contract: the entry point writes the queue
//!   entry, bumps `next_request_id` and updates both queue lengths *before* it
//!   validates the token registry and the funds available. Every rejection —
//!   zero amount, unregistered token, over-balance, denied recipient, paused,
//!   circuit breaker — must therefore roll the whole lot back.
//! * **Unauthorised callers are rejected** and leave no request, no id
//!   consumed and no liability reserved.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token, Address, Bytes, BytesN, Env, Vec,
};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &contract_address.address()),
        token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

/// Everything a `request_withdrawal` test needs: the bridge address and
/// client, the admin, the bridge token and its mint client.
struct Fixture<'a> {
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    admin: Address,
    token_addr: Address,
    token_client: token::Client<'a>,
    token_admin: token::StellarAssetClient<'a>,
}

fn setup_bridge(env: &Env) -> Fixture<'_> {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_addr = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    bridge.init(&admin, &token_addr, &1_000_000, &100, &signers, &1, &0);

    Fixture {
        contract_id,
        bridge,
        admin,
        token_addr,
        token_client,
        token_admin,
    }
}

/// Register a bridge but deliberately leave it uninitialised.
fn setup_uninitialised(env: &Env) -> FiatBridgeClient<'_> {
    let contract_id = env.register(FiatBridge, ());
    FiatBridgeClient::new(env, &contract_id)
}

/// Mint to a fresh address and deposit, so the address has withdrawable funds.
fn funded_user(env: &Env, fx: &Fixture<'_>, deposit: i128) -> Address {
    let user = Address::generate(env);
    fx.token_admin.mint(&user, &(deposit * 2));
    fx.bridge.deposit(
        &user,
        &deposit,
        &fx.token_addr,
        &Bytes::from_slice(env, b"seed"),
        &0,
        &0,
        &None,
    );
    user
}

/// The whole queue + accounting surface, captured as one comparable value.
#[derive(Clone, Debug, PartialEq, Eq)]
struct QueueFingerprint {
    depth: u64,
    total_deposited: i128,
    total_withdrawn: i128,
    total_liabilities: i128,
    next_priority: Option<u64>,
    balance: i128,
}

fn fingerprint(fx: &Fixture<'_>) -> QueueFingerprint {
    QueueFingerprint {
        depth: fx.bridge.get_wq_depth(),
        total_deposited: fx.bridge.get_total_deposited(),
        total_withdrawn: fx.bridge.get_total_withdrawn(),
        total_liabilities: fx.bridge.get_total_liabilities(),
        next_priority: fx.bridge.get_next_priority_withdrawal(),
        balance: fx.token_client.balance(&fx.contract_id),
    }
}

/// Re-assert the three core accounting invariants from `check_invariants`.
fn assert_core_accounting_invariants(fx: &Fixture<'_>) {
    let deposited = fx.bridge.get_total_deposited();
    let withdrawn = fx.bridge.get_total_withdrawn();
    let liabilities = fx.bridge.get_total_liabilities();

    assert!(
        deposited >= withdrawn,
        "total_deposited must never fall below total_withdrawn"
    );
    let net = deposited - withdrawn;
    assert!(
        net >= liabilities,
        "net_deposited ({net}) must always cover outstanding liabilities ({liabilities})"
    );
    assert!(
        fx.token_client.balance(&fx.contract_id) >= net,
        "held balance must always cover net_deposited"
    );
}

// ── Accepted requests ────────────────────────────────────────────────────

/// A single accepted request reserves exactly its amount and keeps all three
/// core accounting invariants intact.
#[test]
fn accepted_request_reserves_exactly_its_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);

    let before = fx.bridge.get_total_liabilities();
    fx.bridge
        .request_withdrawal(&user, &250, &fx.token_addr, &None, &0);

    assert_eq!(fx.bridge.get_total_liabilities(), before + 250);
    assert_core_accounting_invariants(&fx);
}

/// Liabilities accumulate exactly, request by request, and never overtake the
/// net deposited balance.
#[test]
fn liabilities_accumulate_exactly_and_never_exceed_net_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);

    let mut expected = 0i128;
    for amount in [100i128, 250, 50, 400] {
        fx.bridge
            .request_withdrawal(&user, &amount, &fx.token_addr, &None, &0);
        expected += amount;

        assert_eq!(fx.bridge.get_total_liabilities(), expected);
        assert_core_accounting_invariants(&fx);
    }

    let net = fx.bridge.get_total_deposited() - fx.bridge.get_total_withdrawn();
    assert!(expected <= net);
}

/// Ids are the pre-call counter value, increase by exactly one, and are never
/// handed out twice.
#[test]
fn ids_are_allocated_in_order_and_never_reused() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);

    let first = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    let second = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    let third = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &1);

    assert_eq!(second, first + 1);
    assert_eq!(third, second + 1);

    // Cancelling frees the slot but never recycles the id.
    fx.bridge.cancel_withdrawal(&second);
    let fourth = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    assert_eq!(fourth, third + 1);
    assert_ne!(fourth, second);
}

/// Queue depth grows by exactly one, and the new request is reachable through
/// the tier scheduler.
#[test]
fn queue_depth_grows_by_exactly_one_per_request() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);

    for expected_depth in 1u64..=4 {
        let id = fx
            .bridge
            .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
        assert_eq!(fx.bridge.get_wq_depth(), expected_depth);
        assert!(fx.bridge.get_withdrawal_request(&id).is_some());
    }

    // Tier 0 was used throughout, so the scheduler serves the oldest request.
    assert_eq!(fx.bridge.get_next_priority_withdrawal(), Some(0));
}

/// The stored request mirrors the caller's inputs and the ledger clock.
#[test]
fn stored_request_reflects_its_inputs_faithfully() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    fx.bridge.set_lock_period(&25);
    let user = funded_user(&env, &fx, 1_000);

    let memo = BytesN::from_array(&env, &[7u8; 32]);
    let queued_at = env.ledger().sequence();

    let id = fx.bridge.request_withdrawal(
        &user,
        &175,
        &fx.token_addr,
        &Some(memo.clone()),
        &3,
    );

    let stored = fx
        .bridge
        .get_withdrawal_request(&id)
        .expect("an accepted request must be readable back");

    assert_eq!(stored.to, user);
    assert_eq!(stored.token, fx.token_addr);
    assert_eq!(stored.amount, 175);
    assert_eq!(stored.memo_hash, Some(memo));
    assert_eq!(stored.risk_tier, 3);
    assert_eq!(stored.queued_ledger, queued_at);
    assert_eq!(
        stored.unlock_ledger,
        queued_at + 25,
        "unlock_ledger must be queued_ledger plus the configured lock period"
    );
}

/// Requests from different users are accounted independently but share one
/// pool of liabilities.
#[test]
fn multiple_users_share_one_liability_pool_without_breaking_invariants() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let alice = funded_user(&env, &fx, 1_000);
    let bob = funded_user(&env, &fx, 1_000);

    fx.bridge
        .request_withdrawal(&alice, &600, &fx.token_addr, &None, &0);
    fx.bridge
        .request_withdrawal(&bob, &600, &fx.token_addr, &None, &0);

    assert_eq!(fx.bridge.get_total_liabilities(), 1_200);
    assert_core_accounting_invariants(&fx);

    // Neither user may reserve more than they personally deposited.
    assert_eq!(
        fx.bridge
            .try_request_withdrawal(&alice, &1_001, &fx.token_addr, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
    assert_core_accounting_invariants(&fx);
}

// ── Failure paths leave no partial state ─────────────────────────────────

/// Zero and negative amounts are rejected outright.
#[test]
fn non_positive_amounts_are_rejected_without_side_effects() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);
    let before = fingerprint(&fx);

    for amount in [0i128, -1, -1_000] {
        assert_eq!(
            fx.bridge
                .try_request_withdrawal(&user, &amount, &fx.token_addr, &None, &0),
            Err(Ok(Error::ZeroAmount))
        );
        assert_eq!(before, fingerprint(&fx));
    }
}

/// An unregistered token is rejected *after* the entry point has already
/// written the queue entry and bumped the id counter, so this is the sharpest
/// test that failures roll back wholesale.
#[test]
fn unregistered_token_rolls_back_the_queue_write() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);

    let existing = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    let before = fingerprint(&fx);

    let stranger_admin = Address::generate(&env);
    let (stranger_token, _) = create_token_contract(&env, &stranger_admin);

    assert_eq!(
        fx.bridge
            .try_request_withdrawal(&user, &10, &stranger_token.address, &None, &0),
        Err(Ok(Error::TokenNotWhitelisted))
    );

    assert_eq!(before, fingerprint(&fx));
    assert!(
        fx.bridge.get_withdrawal_request(&(existing + 1)).is_none(),
        "the rejected request must not survive at the id it would have taken"
    );

    // The id counter never advanced.
    let next = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    assert_eq!(next, existing + 1);
}

/// Requesting more than the user deposited is rejected and reserves nothing.
#[test]
fn over_balance_request_reserves_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 500);
    let before = fingerprint(&fx);

    assert_eq!(
        fx.bridge
            .try_request_withdrawal(&user, &501, &fx.token_addr, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
    assert_eq!(before, fingerprint(&fx));
    assert_core_accounting_invariants(&fx);
}

/// Liabilities can never be pushed past the net deposited balance, even by a
/// sequence of individually valid requests.
#[test]
fn liabilities_can_never_be_pushed_past_net_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let alice = funded_user(&env, &fx, 1_000);
    let bob = funded_user(&env, &fx, 1_000);

    fx.bridge
        .request_withdrawal(&alice, &1_000, &fx.token_addr, &None, &0);
    fx.bridge
        .request_withdrawal(&bob, &1_000, &fx.token_addr, &None, &0);

    let net = fx.bridge.get_total_deposited() - fx.bridge.get_total_withdrawn();
    assert_eq!(fx.bridge.get_total_liabilities(), net);

    let before = fingerprint(&fx);

    // Alice has no unreserved balance left; a further request would push
    // liabilities above net deposited.
    assert_eq!(
        fx.bridge
            .try_request_withdrawal(&alice, &1, &fx.token_addr, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
    assert_eq!(before.total_liabilities, fx.bridge.get_total_liabilities());
    assert_core_accounting_invariants(&fx);
}

/// A denied recipient is rejected and leaves the queue untouched.
#[test]
fn denied_recipient_is_rejected_without_side_effects() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);
    fx.bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);

    fx.bridge.deny_address(&user);
    let before = fingerprint(&fx);

    assert_eq!(
        fx.bridge
            .try_request_withdrawal(&user, &10, &fx.token_addr, &None, &0),
        Err(Ok(Error::AddressDenied))
    );
    assert_eq!(before, fingerprint(&fx));

    // Lifting the denial restores normal service.
    fx.bridge.remove_denied_address(&user);
    fx.bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    assert_eq!(fx.bridge.get_wq_depth(), before.depth + 1);
}

/// A paused contract accepts no requests and keeps the queue exactly as it was.
#[test]
fn paused_contract_accepts_no_requests() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);
    fx.bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    let before = fingerprint(&fx);

    fx.bridge.pause();
    assert!(fx
        .bridge
        .try_request_withdrawal(&user, &10, &fx.token_addr, &None, &0)
        .is_err());

    fx.bridge.unpause();
    assert_eq!(before, fingerprint(&fx));
}

/// An uninitialised contract has no admin to authorise against and no token
/// registry, so nothing can be queued.
#[test]
fn uninitialised_contract_queues_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge = setup_uninitialised(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    assert_eq!(
        bridge.try_request_withdrawal(&user, &10, &token, &None, &0),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(bridge.get_wq_depth(), 0);
    assert!(bridge.get_withdrawal_request(&0).is_none());
    assert_eq!(bridge.get_next_priority_withdrawal(), None);
}

/// Without admin authorisation nothing is queued and no id is consumed.
#[test]
fn unauthorised_caller_queues_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx, 1_000);
    let existing = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    let before = fingerprint(&fx);

    // Drop the blanket auth mock so `admin.require_auth()` genuinely fails.
    env.set_auths(&[]);

    assert!(
        fx.bridge
            .try_request_withdrawal(&user, &10, &fx.token_addr, &None, &0)
            .is_err(),
        "request_withdrawal must reject a caller that cannot satisfy admin auth"
    );

    // Re-enable auth purely to read state back.
    env.mock_all_auths();
    assert_eq!(before, fingerprint(&fx));
    assert!(fx.bridge.get_withdrawal_request(&(existing + 1)).is_none());

    let next = fx
        .bridge
        .request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
    assert_eq!(
        next,
        existing + 1,
        "an unauthorised attempt must not consume a request id"
    );
    assert_eq!(fx.admin, fx.bridge.get_admin());
}

// ── Property-based sweep ─────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// For any positive amount within the depositor's balance, the request is
    /// accepted, reserves exactly that amount, and leaves every core
    /// accounting invariant intact.
    #[test]
    fn any_valid_amount_reserves_exactly_itself(
        deposit in 100i128..5_000,
        fraction in 1i128..100,
        tier in 0u32..4,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let fx = setup_bridge(&env);
        let user = funded_user(&env, &fx, deposit);

        let amount = (deposit * fraction / 100).max(1);
        let before = fx.bridge.get_total_liabilities();

        let id = fx.bridge.request_withdrawal(&user, &amount, &fx.token_addr, &None, &tier);

        prop_assert_eq!(fx.bridge.get_total_liabilities(), before + amount);
        prop_assert_eq!(fx.bridge.get_wq_depth(), 1);

        let stored = fx.bridge.get_withdrawal_request(&id).unwrap();
        prop_assert_eq!(stored.amount, amount);
        prop_assert_eq!(stored.risk_tier, tier);

        let deposited = fx.bridge.get_total_deposited();
        let withdrawn = fx.bridge.get_total_withdrawn();
        prop_assert!(deposited >= withdrawn);
        prop_assert!(deposited - withdrawn >= fx.bridge.get_total_liabilities());
        prop_assert!(
            fx.token_client.balance(&fx.contract_id) >= deposited - withdrawn
        );
    }

    /// Any amount above the depositor's balance is refused, and refusing it
    /// changes nothing at all.
    #[test]
    fn any_over_balance_amount_is_refused_without_side_effects(
        deposit in 100i128..2_000,
        excess in 1i128..10_000,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let fx = setup_bridge(&env);
        let user = funded_user(&env, &fx, deposit);
        let before = fingerprint(&fx);

        prop_assert_eq!(
            fx.bridge.try_request_withdrawal(
                &user,
                &(deposit + excess),
                &fx.token_addr,
                &None,
                &0,
            ),
            Err(Ok(Error::InsufficientFunds))
        );
        prop_assert_eq!(before, fingerprint(&fx));
    }

    /// Ids stay dense and ordered across any number of accepted requests, and
    /// queue depth always equals the number accepted.
    #[test]
    fn ids_stay_dense_and_ordered_for_any_request_count(count in 1u64..8) {
        let env = Env::default();
        env.mock_all_auths();

        let fx = setup_bridge(&env);
        let user = funded_user(&env, &fx, 10_000);

        let mut previous: Option<u64> = None;
        for n in 0..count {
            let id = fx.bridge.request_withdrawal(&user, &10, &fx.token_addr, &None, &0);
            prop_assert_eq!(id, n);
            if let Some(prev) = previous {
                prop_assert_eq!(id, prev + 1);
            }
            previous = Some(id);
            prop_assert_eq!(fx.bridge.get_wq_depth(), n + 1);
        }

        prop_assert_eq!(fx.bridge.get_total_liabilities(), 10 * count as i128);
    }

    /// Whatever lock period is configured, `unlock_ledger` is exactly
    /// `queued_ledger + lock_period` and never lands in the past.
    #[test]
    fn unlock_ledger_always_trails_the_configured_lock_period(lock in 0u32..5_000) {
        let env = Env::default();
        env.mock_all_auths();

        let fx = setup_bridge(&env);
        fx.bridge.set_lock_period(&lock);
        let user = funded_user(&env, &fx, 1_000);

        let queued_at = env.ledger().sequence();
        let id = fx.bridge.request_withdrawal(&user, &10, &fx.token_addr, &None, &0);

        let stored = fx.bridge.get_withdrawal_request(&id).unwrap();
        prop_assert_eq!(stored.queued_ledger, queued_at);
        prop_assert_eq!(stored.unlock_ledger, queued_at + lock);
        prop_assert!(stored.unlock_ledger >= stored.queued_ledger);
    }
}
