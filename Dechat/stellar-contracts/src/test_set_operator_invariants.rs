//! Invariant tests for [`FiatBridge::set_operator`].
//!
//! `set_operator` is the single door through which the operator role is
//! granted and revoked. It guards against role confusion (the admin and the
//! contract itself can never be operators), enforces per-operator nonce replay
//! protection, prunes operators that have gone silent, and honours the
//! `max_operators` cap. The invariants asserted here are:
//!
//! * **The flag is the truth.** After an accepted call
//!   `is_operator(operator) == active`, and no other address's flag moves.
//! * **The roster matches the flags.** The `operator_count` carried by
//!   [`SetOperatorEvent`] always equals the number of distinct addresses whose
//!   operator flag is set, and never exceeds a configured `max_operators`.
//! * **Grant and revoke are exact inverses.** Activating then deactivating an
//!   address returns the roster to precisely its previous size; re-activating
//!   an already-active operator is a no-op that never double-counts.
//! * **Nonces move once, forwards only.** An accepted call increments the
//!   caller's operator nonce by exactly one; every rejected call leaves it
//!   untouched, so a failure can never be used to burn or skip a nonce.
//! * **Failure paths do not partially mutate storage.** Role-confusion
//!   rejections, a stale or future nonce, deactivating a non-operator, and
//!   hitting the cap all leave the operator flag, the roster size and the
//!   nonce exactly as they were, and emit no operator-transition event.
//! * **Unauthorised callers are rejected.** Without admin authorisation the
//!   call fails and no flag or nonce survives it.
//! * **Accounting is out of scope and stays that way.** `total_deposited`,
//!   `total_withdrawn`, `total_liabilities` and the configured limit are
//!   identical before and after any call, accepted or rejected.
//!
//! ## Event surface
//!
//! [`SetOperatorEvent`] carries `previous_active` and `operator_count`
//! alongside the operator and its new flag, mirroring the transition-reporting
//! convention `SetMaxOperatorsEvent` already established. That makes the
//! roster-size invariant auditable straight from the event stream, which is
//! what the tests below read it for.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient, EVENT_VERSION};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token,
    xdr::{ContractEventBody, ScSymbol, ScVal, StringM},
    Address, Env, Vec,
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

/// Register and initialise a bridge; returns its address, client and admin.
fn setup_bridge(env: &Env) -> (Address, FiatBridgeClient<'_>, Address) {
    let admin = Address::generate(env);
    let (token_client, _token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    (contract_id, client, admin)
}

/// Register a bridge but deliberately leave it uninitialised.
fn setup_uninitialised(env: &Env) -> FiatBridgeClient<'_> {
    let contract_id = env.register(FiatBridge, ());
    FiatBridgeClient::new(env, &contract_id)
}

/// Look up a field by name in the data map of the most recent bridge event.
fn last_event_field(env: &Env, contract_id: &Address, field: &str) -> Option<ScVal> {
    let events = env.events().all().filter_by_contract(contract_id);
    let raw = events.events();
    let event = raw.last()?;
    let ContractEventBody::V0(body) = &event.body;
    match &body.data {
        ScVal::Map(Some(map)) => map.iter().find_map(|entry| {
            let key = ScVal::Symbol(ScSymbol(StringM::try_from(field).ok()?));
            if entry.key == key {
                Some(entry.val.clone())
            } else {
                None
            }
        }),
        _ => None,
    }
}

fn last_event_u32(env: &Env, contract_id: &Address, field: &str) -> Option<u32> {
    match last_event_field(env, contract_id, field) {
        Some(ScVal::U32(v)) => Some(v),
        _ => None,
    }
}

fn last_event_bool(env: &Env, contract_id: &Address, field: &str) -> Option<bool> {
    match last_event_field(env, contract_id, field) {
        Some(ScVal::Bool(v)) => Some(v),
        _ => None,
    }
}

/// Count the `SetOperatorEvent`s in the bridge's log.
///
/// The Soroban test host discards the recorded event log when an invocation
/// fails, so a plain before/after count cannot distinguish "no event was
/// emitted" from "the log was reset". Matching on `previous_active` — a field
/// unique to `SetOperatorEvent` — answers the question that actually matters:
/// did a rejected call leave an operator-transition record behind?
fn set_operator_event_count(env: &Env, contract_id: &Address) -> usize {
    let events = env.events().all().filter_by_contract(contract_id);
    events
        .events()
        .iter()
        .filter(|event| {
            let ContractEventBody::V0(body) = &event.body;
            match &body.data {
                ScVal::Map(Some(map)) => map.iter().any(|entry| {
                    StringM::try_from("previous_active")
                        .map(|name| entry.key == ScVal::Symbol(ScSymbol(name)))
                        .unwrap_or(false)
                }),
                _ => false,
            }
        })
        .count()
}

/// The accounting surface `set_operator` must never touch.
#[derive(Clone, Debug, PartialEq, Eq)]
struct AccountingFingerprint {
    limit: i128,
    total_deposited: i128,
    total_withdrawn: i128,
    total_liabilities: i128,
}

fn accounting(bridge: &FiatBridgeClient<'_>) -> AccountingFingerprint {
    AccountingFingerprint {
        limit: bridge.get_limit(),
        total_deposited: bridge.get_total_deposited(),
        total_withdrawn: bridge.get_total_withdrawn(),
        total_liabilities: bridge.get_total_liabilities(),
    }
}

// ── The flag is the truth ────────────────────────────────────────────────

/// An accepted activation sets exactly the target's flag, and deactivation is
/// its exact inverse.
#[test]
fn activation_and_deactivation_are_exact_inverses() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);
    let bystander = Address::generate(&env);

    bridge.set_operator(&operator, &true, &0);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(1));
    assert!(bridge.is_operator(&operator));
    assert!(!bridge.is_operator(&bystander));

    bridge.set_operator(&operator, &false, &1);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(0));
    assert!(!bridge.is_operator(&operator));
    assert!(!bridge.is_operator(&bystander));
}

/// Re-activating an already-active operator is idempotent: the flag stays set
/// and the roster never double-counts the same address.
#[test]
fn repeated_activation_never_double_counts_the_roster() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    for nonce in 0u64..4 {
        bridge.set_operator(&operator, &true, &nonce);
        assert_eq!(
            last_event_u32(&env, &contract_id, "operator_count"),
            Some(1),
            "re-activating the same operator must not grow the roster"
        );
    }
    assert!(bridge.is_operator(&operator));
}

/// The roster size reported by the event tracks the number of active operators
/// exactly as they are added and removed.
#[test]
fn roster_size_tracks_the_number_of_active_operators() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    bridge.set_operator(&a, &true, &0);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(1));
    bridge.set_operator(&b, &true, &0);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(2));
    bridge.set_operator(&c, &true, &0);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(3));

    bridge.set_operator(&b, &false, &1);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(2));

    assert!(bridge.is_operator(&a));
    assert!(!bridge.is_operator(&b));
    assert!(bridge.is_operator(&c));
}

// ── Event surface ────────────────────────────────────────────────────────

/// The event carries the full transition — version, new flag, previous flag
/// and the resulting roster size.
#[test]
fn event_reports_the_full_transition() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true, &0);
    assert_eq!(
        last_event_u32(&env, &contract_id, "version"),
        Some(EVENT_VERSION)
    );
    assert_eq!(last_event_bool(&env, &contract_id, "active"), Some(true));
    assert_eq!(
        last_event_bool(&env, &contract_id, "previous_active"),
        Some(false),
        "the first activation must report a false previous flag"
    );
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(1));

    bridge.set_operator(&operator, &true, &1);
    assert_eq!(
        last_event_bool(&env, &contract_id, "previous_active"),
        Some(true),
        "a no-op re-activation must be distinguishable from a real transition"
    );

    bridge.set_operator(&operator, &false, &2);
    assert_eq!(last_event_bool(&env, &contract_id, "active"), Some(false));
    assert_eq!(
        last_event_bool(&env, &contract_id, "previous_active"),
        Some(true)
    );
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(0));
}

/// A rejected call emits nothing at all.
#[test]
fn rejected_calls_emit_no_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin) = setup_bridge(&env);
    let stranger = Address::generate(&env);

    assert_eq!(
        bridge.try_set_operator(&admin, &true, &0),
        Err(Ok(Error::NotAllowed))
    );
    assert_eq!(
        bridge.try_set_operator(&contract_id, &true, &0),
        Err(Ok(Error::InvalidRecipient))
    );
    assert_eq!(
        bridge.try_set_operator(&stranger, &false, &0),
        Err(Ok(Error::NotOperator))
    );
    assert_eq!(
        bridge.try_set_operator(&stranger, &true, &7),
        Err(Ok(Error::InvalidNonce))
    );

    assert_eq!(
        set_operator_event_count(&env, &contract_id),
        0,
        "a rejected set_operator must not leave an event behind"
    );

    // The very next accepted call does emit one, so the check above is not
    // vacuously true.
    bridge.set_operator(&stranger, &true, &0);
    assert_eq!(set_operator_event_count(&env, &contract_id), 1);
}

// ── Role-confusion guards ────────────────────────────────────────────────

/// The admin can never hold the operator role.
#[test]
fn admin_can_never_become_an_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, admin) = setup_bridge(&env);

    assert_eq!(
        bridge.try_set_operator(&admin, &true, &0),
        Err(Ok(Error::NotAllowed))
    );
    assert!(!bridge.is_operator(&admin));
    assert_eq!(bridge.get_operator_nonce(&admin), 0);
}

/// The contract can never hold the operator role either.
#[test]
fn contract_address_can_never_become_an_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    assert_eq!(
        bridge.try_set_operator(&contract_id, &true, &0),
        Err(Ok(Error::InvalidRecipient))
    );
    assert!(!bridge.is_operator(&contract_id));
    assert_eq!(bridge.get_operator_nonce(&contract_id), 0);
}

/// Deactivating an address that was never an operator is rejected outright
/// rather than silently writing a `false` flag.
#[test]
fn deactivating_a_non_operator_is_rejected_and_writes_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let stranger = Address::generate(&env);

    assert_eq!(
        bridge.try_set_operator(&stranger, &false, &0),
        Err(Ok(Error::NotOperator))
    );
    assert!(!bridge.is_operator(&stranger));
    assert_eq!(bridge.get_operator_nonce(&stranger), 0);
}

// ── Cap ──────────────────────────────────────────────────────────────────

/// The roster never grows past a configured `max_operators`, and the call that
/// would breach it changes nothing.
#[test]
fn roster_never_exceeds_the_configured_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    bridge.set_max_operators(&2);

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    bridge.set_operator(&a, &true, &0);
    bridge.set_operator(&b, &true, &0);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(2));

    assert_eq!(
        bridge.try_set_operator(&c, &true, &0),
        Err(Ok(Error::OperatorCapReached))
    );
    assert!(!bridge.is_operator(&c));
    assert_eq!(
        bridge.get_operator_nonce(&c),
        0,
        "a call rejected by the cap must not burn the operator's nonce"
    );

    // Freeing a slot lets the third operator in, and the roster stays at the cap.
    bridge.set_operator(&a, &false, &1);
    bridge.set_operator(&c, &true, &0);
    assert_eq!(last_event_u32(&env, &contract_id, "operator_count"), Some(2));
}

// ── Nonces ───────────────────────────────────────────────────────────────

/// Each accepted call advances the operator's nonce by exactly one.
#[test]
fn accepted_calls_advance_the_nonce_by_exactly_one() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    assert_eq!(bridge.get_operator_nonce(&operator), 0);
    bridge.set_operator(&operator, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
    bridge.set_operator(&operator, &false, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);
    bridge.set_operator(&operator, &true, &2);
    assert_eq!(bridge.get_operator_nonce(&operator), 3);
}

/// Replaying a consumed nonce, or skipping ahead, is rejected and leaves both
/// the nonce and the flag exactly where they were.
#[test]
fn stale_and_future_nonces_are_rejected_without_side_effects() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Replay of the consumed nonce.
    assert_eq!(
        bridge.try_set_operator(&operator, &false, &0),
        Err(Ok(Error::StaleNonce))
    );
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
    assert!(bridge.is_operator(&operator));

    // Skipping ahead.
    assert_eq!(
        bridge.try_set_operator(&operator, &false, &99),
        Err(Ok(Error::InvalidNonce))
    );
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
    assert!(bridge.is_operator(&operator));

    // The correct nonce still works afterwards.
    bridge.set_operator(&operator, &false, &1);
    assert!(!bridge.is_operator(&operator));
}

/// Nonces are per operator: consuming one address's nonce leaves every other
/// address's counter untouched.
#[test]
fn nonces_are_scoped_per_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    bridge.set_operator(&a, &true, &0);
    bridge.set_operator(&a, &false, &1);

    assert_eq!(bridge.get_operator_nonce(&a), 2);
    assert_eq!(bridge.get_operator_nonce(&b), 0);

    bridge.set_operator(&b, &true, &0);
    assert_eq!(bridge.get_operator_nonce(&a), 2);
    assert_eq!(bridge.get_operator_nonce(&b), 1);
}

// ── Authorisation and uninitialised state ────────────────────────────────

/// Without admin authorisation the call is rejected and nothing survives it.
#[test]
fn unauthorised_caller_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let existing = Address::generate(&env);
    let hijacker = Address::generate(&env);

    bridge.set_operator(&existing, &true, &0);
    let accounting_before = accounting(&bridge);

    // Drop the blanket auth mock so `admin.require_auth()` genuinely fails.
    env.set_auths(&[]);

    assert!(
        bridge.try_set_operator(&hijacker, &true, &0).is_err(),
        "set_operator must reject a caller that cannot satisfy admin auth"
    );
    assert!(
        bridge.try_set_operator(&existing, &false, &1).is_err(),
        "an unauthorised caller must not be able to revoke an operator"
    );

    // Re-enable auth purely to read state back.
    env.mock_all_auths();
    assert!(!bridge.is_operator(&hijacker));
    assert!(bridge.is_operator(&existing));
    assert_eq!(bridge.get_operator_nonce(&hijacker), 0);
    assert_eq!(bridge.get_operator_nonce(&existing), 1);
    assert_eq!(accounting_before, accounting(&bridge));
}

/// An uninitialised contract has no admin to authorise against, so the call
/// fails before touching anything.
#[test]
fn uninitialised_contract_rejects_and_writes_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge = setup_uninitialised(&env);
    let operator = Address::generate(&env);

    assert_eq!(
        bridge.try_set_operator(&operator, &true, &0),
        Err(Ok(Error::NotInitialized))
    );
    assert!(!bridge.is_operator(&operator));
    assert_eq!(bridge.get_operator_nonce(&operator), 0);
}

// ── Accounting is untouched ──────────────────────────────────────────────

/// The operator role has nothing to do with token accounting, and neither an
/// accepted nor a rejected call may disturb it.
#[test]
fn accounting_is_untouched_by_accepted_and_rejected_calls() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    let before = accounting(&bridge);

    bridge.set_operator(&operator, &true, &0);
    assert_eq!(before, accounting(&bridge));

    let _ = bridge.try_set_operator(&admin, &true, &0);
    let _ = bridge.try_set_operator(&operator, &true, &99);
    assert_eq!(before, accounting(&bridge));

    bridge.set_operator(&operator, &false, &1);
    assert_eq!(before, accounting(&bridge));
}

// ── Property-based sweep ─────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// However many operators are granted and revoked, the roster size the
    /// event reports always equals the number of addresses whose flag is set.
    #[test]
    fn roster_size_always_equals_the_number_of_set_flags(
        grants in 1usize..6,
        revokes in 0usize..6,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _admin) = setup_bridge(&env);

        // Tier the addresses into a fixed-size array: this crate is `#![no_std]`.
        let mut operators: [Option<Address>; 6] = [None, None, None, None, None, None];
        for slot in operators.iter_mut().take(grants) {
            *slot = Some(Address::generate(&env));
        }

        let mut active = 0u32;
        for slot in operators.iter().take(grants) {
            let op = slot.as_ref().unwrap();
            bridge.set_operator(op, &true, &0);
            active += 1;
            prop_assert_eq!(
                last_event_u32(&env, &contract_id, "operator_count"),
                Some(active)
            );
        }

        let to_revoke = revokes.min(grants);
        for slot in operators.iter().take(to_revoke) {
            let op = slot.as_ref().unwrap();
            bridge.set_operator(op, &false, &1);
            active -= 1;
            prop_assert_eq!(
                last_event_u32(&env, &contract_id, "operator_count"),
                Some(active)
            );
        }

        // The flags themselves agree with the count the events reported.
        let mut counted = 0u32;
        for slot in operators.iter().take(grants) {
            if bridge.is_operator(slot.as_ref().unwrap()) {
                counted += 1;
            }
        }
        prop_assert_eq!(counted, active);
    }

    /// For any cap, the roster stops growing at exactly the cap and the
    /// rejected call leaves no trace.
    #[test]
    fn roster_stops_growing_at_any_cap(cap in 1u32..5) {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, bridge, _admin) = setup_bridge(&env);
        bridge.set_max_operators(&cap);

        for _ in 0..cap {
            bridge.set_operator(&Address::generate(&env), &true, &0);
        }
        prop_assert_eq!(
            last_event_u32(&env, &contract_id, "operator_count"),
            Some(cap)
        );

        let overflow = Address::generate(&env);
        prop_assert_eq!(
            bridge.try_set_operator(&overflow, &true, &0),
            Err(Ok(Error::OperatorCapReached))
        );
        prop_assert!(!bridge.is_operator(&overflow));
        prop_assert_eq!(bridge.get_operator_nonce(&overflow), 0);
    }

    /// Any rejected nonce — stale or ahead — leaves the counter and the flag
    /// untouched, whatever value is offered.
    #[test]
    fn any_wrong_nonce_leaves_state_untouched(offered in 1u64..500) {
        let env = Env::default();
        env.mock_all_auths();

        let (_contract_id, bridge, _admin) = setup_bridge(&env);
        let operator = Address::generate(&env);

        prop_assert_eq!(
            bridge.try_set_operator(&operator, &true, &offered),
            Err(Ok(Error::InvalidNonce))
        );
        prop_assert_eq!(bridge.get_operator_nonce(&operator), 0);
        prop_assert!(!bridge.is_operator(&operator));

        // Now consume nonce 0 and replay every value below the new counter.
        bridge.set_operator(&operator, &true, &0);
        prop_assert_eq!(bridge.get_operator_nonce(&operator), 1);
        prop_assert_eq!(
            bridge.try_set_operator(&operator, &false, &0),
            Err(Ok(Error::StaleNonce))
        );
        prop_assert_eq!(bridge.get_operator_nonce(&operator), 1);
        prop_assert!(bridge.is_operator(&operator));
    }
}
