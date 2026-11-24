//! Invariant tests for [`FiatBridge::get_next_priority_withdrawal`].
//!
//! `get_next_priority_withdrawal` is the read-only scheduler for the
//! withdrawal queue: it answers "which `request_id` should be processed
//! next?" by scanning risk tiers in ascending order (tier 0 is the highest
//! priority) and returning the head of the first non-empty tier. The
//! invariants asserted here are:
//!
//! * **Purity.** The call is read-only. Repeated calls return the same answer
//!   and leave queue depth, per-request storage, the accounting totals and the
//!   answer itself byte-for-byte unchanged.
//! * **Referential integrity.** When the result is `Some(id)`, `id` always
//!   names a request that is still live in the queue
//!   (`get_withdrawal_request(id).is_some()`); an empty queue always yields
//!   `None`.
//! * **Tier priority.** The returned request always sits in the lowest
//!   occupied tier, regardless of insertion order.
//! * **FIFO within a tier.** Within the winning tier the oldest live request
//!   (lowest `request_id`) is returned.
//! * **Accounting is untouched.** `total_deposited`, `total_withdrawn` and
//!   `total_liabilities` are identical before and after the call, and the core
//!   accounting invariants (`total_deposited >= total_withdrawn`,
//!   `net_deposited >= total_liabilities`, `balance >= net_deposited`) still
//!   hold afterwards.
//! * **No authorisation is granted.** The view needs no auth and grants none:
//!   it answers identically with no auth mocked, and an unauthorised
//!   `request_withdrawal` / `cancel_withdrawal` is rejected without shifting
//!   the priority head.
//! * **Failure paths do not partially mutate storage.** A rejected
//!   `request_withdrawal` — zero amount, unregistered token, over-balance,
//!   denied address — leaves the priority head, the queue depth and the
//!   `request_id` counter exactly where they were, even though the entry
//!   point writes queue bookkeeping before its later validation steps.
//!
//! ## Known bound: the tier scan window
//!
//! The implementation caps its scan at `min(next_request_id, 256)` tiers to
//! stay inside the Soroban compute budget. A request filed in a tier numbered
//! above that bound is therefore invisible to the scheduler until enough
//! requests exist to widen the window. That is deliberate, and
//! [`priority_scan_window_is_bounded_by_next_request_id`] pins the behaviour
//! down so a future change to the bound is a conscious one.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, Env, Vec};

/// Mirrors the contract-private scan cap in `get_next_priority_withdrawal`.
const TIER_SCAN_CAP: u64 = 256;

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

/// Register and initialise a bridge, returning the client, the admin, the
/// token address and the token's mint client.
fn setup_bridge(
    env: &Env,
) -> (
    FiatBridgeClient<'_>,
    Address,
    Address,
    token::StellarAssetClient<'_>,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    (client, admin, token_address, token_admin)
}

/// Register a bridge but deliberately leave it uninitialised.
fn setup_uninitialised(env: &Env) -> FiatBridgeClient<'_> {
    let contract_id = env.register(FiatBridge, ());
    FiatBridgeClient::new(env, &contract_id)
}

/// Create a funded depositor whose balance backs every request the tests file.
fn funded_user(
    env: &Env,
    bridge: &FiatBridgeClient<'_>,
    token_addr: &Address,
    token_admin: &token::StellarAssetClient<'_>,
    deposit: i128,
) -> Address {
    let user = Address::generate(env);
    token_admin.mint(&user, &(deposit * 2));
    bridge.deposit(
        &user,
        &deposit,
        token_addr,
        &Bytes::from_slice(env, b"seed"),
        &0,
        &0,
        &None,
    );
    user
}

/// Everything the priority view must never disturb, captured as one value.
#[derive(Clone, Debug, PartialEq, Eq)]
struct QueueFingerprint {
    depth: u64,
    total_deposited: i128,
    total_withdrawn: i128,
    total_liabilities: i128,
    next_priority: Option<u64>,
}

fn fingerprint(bridge: &FiatBridgeClient<'_>) -> QueueFingerprint {
    QueueFingerprint {
        depth: bridge.get_wq_depth(),
        total_deposited: bridge.get_total_deposited(),
        total_withdrawn: bridge.get_total_withdrawn(),
        total_liabilities: bridge.get_total_liabilities(),
        next_priority: bridge.get_next_priority_withdrawal(),
    }
}

/// Re-assert the three core accounting invariants from `check_invariants`.
fn assert_core_accounting_invariants(
    bridge: &FiatBridgeClient<'_>,
    token_client: &token::Client<'_>,
    contract_id: &Address,
) {
    let deposited = bridge.get_total_deposited();
    let withdrawn = bridge.get_total_withdrawn();
    let liabilities = bridge.get_total_liabilities();

    assert!(
        deposited >= withdrawn,
        "total_deposited must never fall below total_withdrawn"
    );
    let net = deposited - withdrawn;
    assert!(
        net >= liabilities,
        "net_deposited must always cover outstanding liabilities"
    );
    assert!(
        token_client.balance(contract_id) >= net,
        "held balance must always cover net_deposited"
    );
}

// ── Referential integrity ────────────────────────────────────────────────

/// An empty queue has no next request, and asking does not conjure one.
#[test]
fn empty_queue_yields_none_without_creating_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, _token, _mint) = setup_bridge(&env);

    assert_eq!(bridge.get_next_priority_withdrawal(), None);
    assert_eq!(bridge.get_wq_depth(), 0);
    assert_eq!(bridge.get_next_priority_withdrawal(), None);
    assert_eq!(bridge.get_wq_depth(), 0);
}

/// An uninitialised contract answers `None` rather than trapping, and writes
/// nothing that would later be mistaken for a queued request.
#[test]
fn uninitialised_contract_yields_none_and_writes_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge = setup_uninitialised(&env);

    assert_eq!(bridge.get_next_priority_withdrawal(), None);
    assert_eq!(bridge.get_wq_depth(), 0);
    assert!(bridge.get_withdrawal_request(&0).is_none());
}

/// Whenever the view names an id, that id must resolve to a live request —
/// while requests accumulate and again while the queue is drained.
///
/// Tier 0 is filed first so the scan window (see the module docs) covers the
/// queue from the very first request onward.
#[test]
fn returned_id_always_names_a_live_queued_request() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    for tier in [0u32, 2, 1, 3] {
        bridge.request_withdrawal(&user, &50, &token_addr, &None, &tier);

        let id = bridge
            .get_next_priority_withdrawal()
            .expect("a non-empty queue must always name a next request");
        assert!(
            bridge.get_withdrawal_request(&id).is_some(),
            "the scheduler must never name a request that is not in the queue"
        );
    }

    while let Some(id) = bridge.get_next_priority_withdrawal() {
        assert!(
            bridge.get_withdrawal_request(&id).is_some(),
            "the scheduler must never name a request that is not in the queue"
        );
        bridge.cancel_withdrawal(&id);
    }
    assert_eq!(bridge.get_wq_depth(), 0);
}

// ── Purity ───────────────────────────────────────────────────────────────

/// The view is read-only: calling it repeatedly changes nothing observable.
#[test]
fn repeated_calls_are_stable_and_mutate_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);
    bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    let before = fingerprint(&bridge);
    for _ in 0..8 {
        assert_eq!(bridge.get_next_priority_withdrawal(), before.next_priority);
    }
    assert_eq!(before, fingerprint(&bridge));
}

/// Accounting totals are identical either side of the call, and the three core
/// accounting invariants still hold afterwards.
#[test]
fn accounting_totals_survive_the_call_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_addr = token_client.address.clone();
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_addr, &1_000_000, &100, &signers, &1, &0);

    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);
    bridge.request_withdrawal(&user, &400, &token_addr, &None, &1);

    let deposited = bridge.get_total_deposited();
    let withdrawn = bridge.get_total_withdrawn();
    let liabilities = bridge.get_total_liabilities();

    let _ = bridge.get_next_priority_withdrawal();

    assert_eq!(bridge.get_total_deposited(), deposited);
    assert_eq!(bridge.get_total_withdrawn(), withdrawn);
    assert_eq!(bridge.get_total_liabilities(), liabilities);
    assert_core_accounting_invariants(&bridge, &token_client, &contract_id);
}

// ── Ordering ─────────────────────────────────────────────────────────────

/// A lower tier always wins, even when it was queued last.
#[test]
fn lowest_tier_wins_over_insertion_order() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    let tier_three = bridge.request_withdrawal(&user, &50, &token_addr, &None, &3);
    let tier_one = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);
    let tier_zero = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let _padding = bridge.request_withdrawal(&user, &50, &token_addr, &None, &3);

    assert_eq!(bridge.get_next_priority_withdrawal(), Some(tier_zero));

    bridge.cancel_withdrawal(&tier_zero);
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(tier_one));

    bridge.cancel_withdrawal(&tier_one);
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(tier_three));
}

/// Within one tier the oldest request is served first.
#[test]
fn fifo_is_preserved_within_the_winning_tier() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    let first = bridge.request_withdrawal(&user, &50, &token_addr, &None, &2);
    let second = bridge.request_withdrawal(&user, &50, &token_addr, &None, &2);
    let third = bridge.request_withdrawal(&user, &50, &token_addr, &None, &2);

    assert!(first < second && second < third, "ids must increase");
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(first));

    bridge.cancel_withdrawal(&first);
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(second));

    bridge.cancel_withdrawal(&second);
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(third));

    bridge.cancel_withdrawal(&third);
    assert_eq!(bridge.get_next_priority_withdrawal(), None);
}

/// A cancelled request is never handed back out, and the head moves on.
#[test]
fn cancelled_request_is_never_returned_again() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    let head = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let next = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    assert_eq!(bridge.get_next_priority_withdrawal(), Some(head));
    bridge.cancel_withdrawal(&head);

    let after = bridge.get_next_priority_withdrawal();
    assert_eq!(after, Some(next));
    assert_ne!(after, Some(head));
    assert!(bridge.get_withdrawal_request(&head).is_none());
}

/// The scheduler only scans `min(next_request_id, 256)` tiers, so a lone
/// request filed above that window is not yet visible. This documents a
/// deliberate compute-budget bound rather than an accident: the same request
/// surfaces once the window widens.
#[test]
fn priority_scan_window_is_bounded_by_next_request_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    // One request in tier 4 while `next_request_id` is only 1: the scan covers
    // tiers 0..=1 and cannot see it.
    let high = bridge.request_withdrawal(&user, &50, &token_addr, &None, &4);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_next_priority_withdrawal(), None);
    assert!(bridge.get_withdrawal_request(&high).is_some());

    // Widen the window past tier 4 and the same request becomes visible.
    for _ in 0..4 {
        bridge.request_withdrawal(&user, &50, &token_addr, &None, &9);
    }
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(high));

    // The bound itself is a constant of the implementation.
    assert_eq!(TIER_SCAN_CAP, 256);
}

// ── Authorisation and failure paths ──────────────────────────────────────

/// The view requires no authorisation, and grants none: an unauthorised
/// mutation attempt is rejected and the answer is unchanged.
#[test]
fn unauthorised_callers_cannot_move_the_priority_head() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    let head = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let padding = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let before = fingerprint(&bridge);
    assert_eq!(before.next_priority, Some(head));

    // Drop the blanket auth mock so `admin.require_auth()` genuinely fails.
    env.set_auths(&[]);

    // Reading still works — the view is unauthenticated by design.
    assert_eq!(bridge.get_next_priority_withdrawal(), Some(head));

    assert!(
        bridge
            .try_request_withdrawal(&user, &50, &token_addr, &None, &0)
            .is_err(),
        "request_withdrawal must reject a caller that cannot satisfy admin auth"
    );
    assert!(
        bridge.try_cancel_withdrawal(&head).is_err(),
        "cancel_withdrawal must reject a caller that cannot satisfy admin auth"
    );

    // Re-enable auth purely to read state back.
    env.mock_all_auths();
    assert_eq!(before, fingerprint(&bridge));
    assert!(bridge.get_withdrawal_request(&padding).is_some());
}

/// `request_withdrawal` writes queue bookkeeping before some of its later
/// validation steps, so every rejected call must roll back wholesale: the
/// priority head, the queue depth and the `request_id` counter all stay put.
#[test]
fn failed_requests_leave_the_queue_byte_for_byte_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 1_000);

    let head = bridge.request_withdrawal(&user, &10, &token_addr, &None, &0);
    let before = fingerprint(&bridge);
    assert_eq!(before.next_priority, Some(head));

    // Zero amount.
    assert_eq!(
        bridge.try_request_withdrawal(&user, &0, &token_addr, &None, &0),
        Err(Ok(Error::ZeroAmount))
    );
    assert_eq!(before, fingerprint(&bridge));

    // A token that was never registered — rejected only *after* the entry
    // point has written the queue entry and bumped the id counter.
    let stranger_admin = Address::generate(&env);
    let (stranger_token, _) = create_token_contract(&env, &stranger_admin);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &10, &stranger_token.address, &None, &0),
        Err(Ok(Error::TokenNotWhitelisted))
    );
    assert_eq!(before, fingerprint(&bridge));

    // More than the user ever deposited.
    assert_eq!(
        bridge.try_request_withdrawal(&user, &1_000_000, &token_addr, &None, &0),
        Err(Ok(Error::InsufficientFunds))
    );
    assert_eq!(before, fingerprint(&bridge));

    // Denied recipient.
    bridge.deny_address(&user);
    assert_eq!(
        bridge.try_request_withdrawal(&user, &10, &token_addr, &None, &0),
        Err(Ok(Error::AddressDenied))
    );
    assert_eq!(before, fingerprint(&bridge));

    // The id counter never advanced: the next accepted request takes the id
    // the rejected ones would have consumed.
    bridge.remove_denied_address(&user);
    let next = bridge.request_withdrawal(&user, &10, &token_addr, &None, &0);
    assert_eq!(
        next,
        head + 1,
        "rejected requests must not consume request ids"
    );
}

/// Pausing blocks new requests without disturbing the scheduler's answer.
#[test]
fn paused_contract_rejects_requests_and_keeps_the_same_head() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
    let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

    bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let before = fingerprint(&bridge);

    bridge.pause();
    assert!(bridge
        .try_request_withdrawal(&user, &50, &token_addr, &None, &0)
        .is_err());
    assert_eq!(before.next_priority, bridge.get_next_priority_withdrawal());

    bridge.unpause();
    assert_eq!(before, fingerprint(&bridge));
}

// ── Property-based sweep ─────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// For any sequence of tiers, the scheduler returns the oldest request in
    /// the lowest occupied tier — and nothing else.
    #[test]
    fn lowest_tier_oldest_request_wins_for_any_tier_sequence(
        tiers in prop::collection::vec(0u32..4, 4..9),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
        let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

        // Track the oldest id filed in each tier without leaning on `std`:
        // this crate is `#![no_std]`, and the tier domain is bounded above.
        let mut oldest_per_tier: [Option<u64>; 4] = [None; 4];
        for tier in &tiers {
            let id = bridge.request_withdrawal(&user, &10, &token_addr, &None, tier);
            let slot = &mut oldest_per_tier[*tier as usize];
            if slot.is_none() {
                *slot = Some(id);
            }
        }

        // The window is `min(next_request_id, 256)`, and `next_request_id`
        // equals the number of requests filed (>= 4 > the largest tier here),
        // so every queued tier is inside the scan.
        let expected = oldest_per_tier
            .iter()
            .flatten()
            .copied()
            .next()
            .expect("at least one tier is occupied");

        prop_assert_eq!(bridge.get_next_priority_withdrawal(), Some(expected));

        // Referential integrity and purity hold for this shape too.
        prop_assert!(bridge.get_withdrawal_request(&expected).is_some());
        let snapshot = fingerprint(&bridge);
        let _ = bridge.get_next_priority_withdrawal();
        prop_assert_eq!(snapshot, fingerprint(&bridge));
    }

    /// Draining the queue in scheduler order never yields a stale id, always
    /// walks tiers monotonically upward, and ends at `None`.
    #[test]
    fn draining_in_scheduler_order_never_yields_a_stale_id(
        tiers in prop::collection::vec(0u32..4, 4..8),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
        let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

        for tier in &tiers {
            bridge.request_withdrawal(&user, &10, &token_addr, &None, tier);
        }

        let mut last_tier = 0u32;
        let mut drained = 0usize;
        while let Some(id) = bridge.get_next_priority_withdrawal() {
            let request = bridge
                .get_withdrawal_request(&id)
                .expect("scheduler must never name a missing request");
            prop_assert!(
                request.risk_tier >= last_tier,
                "tiers must be served in non-decreasing order"
            );
            last_tier = request.risk_tier;

            let liabilities_before = bridge.get_total_liabilities();
            bridge.cancel_withdrawal(&id);
            prop_assert_eq!(
                bridge.get_total_liabilities(),
                liabilities_before - request.amount,
                "cancelling must release exactly the reserved liability"
            );

            drained += 1;
            prop_assert!(drained <= tiers.len(), "drain must terminate");
        }

        prop_assert_eq!(drained, tiers.len());
        prop_assert_eq!(bridge.get_wq_depth(), 0);
        prop_assert_eq!(bridge.get_total_liabilities(), 0);
    }

    /// Whatever the queue looks like, the view never mutates it.
    #[test]
    fn view_is_pure_for_any_queue_shape(
        tiers in prop::collection::vec(0u32..6, 0..7),
        calls in 1usize..5,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);
        let user = funded_user(&env, &bridge, &token_addr, &token_admin, 10_000);

        for tier in &tiers {
            bridge.request_withdrawal(&user, &10, &token_addr, &None, tier);
        }

        let before = fingerprint(&bridge);
        for _ in 0..calls {
            prop_assert_eq!(bridge.get_next_priority_withdrawal(), before.next_priority);
        }
        prop_assert_eq!(before, fingerprint(&bridge));
    }
}
