//! Invariant tests for [`FiatBridge::is_denied`].
//!
//! `is_denied` is a read-only denylist lookup with no state transition of
//! its own — see [`FiatBridge::deny_address`] / [`FiatBridge::remove_denied_address`]
//! for the only two entry points that actually mutate the denylist. The
//! invariants asserted here are:
//!
//! * an address never denied reports `false`;
//! * an address reports `true` immediately after [`FiatBridge::deny_address`]
//!   and `false` again immediately after [`FiatBridge::remove_denied_address`];
//! * the query is read-only — repeated calls never change `DeniedCount` or
//!   any denylist storage, regardless of how many times it's called;
//! * the result tracks each address independently — denying one address
//!   never flips another's answer;
//! * every call emits an `IsDeniedCheckedEvent` naming the address that was
//!   actually queried, carrying `EVENT_VERSION`, and reporting the true
//!   current answer — including on an uninitialised contract, since the
//!   lookup requires no prior `init` call;
//! * the documented `DeniedCount == u64::MAX` overflow guard returns
//!   [`Error::Overflow`] rather than panicking or silently misreporting.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

#![cfg(test)]

use crate::{DataKey, Error, FiatBridge, FiatBridgeClient, EVENT_VERSION};
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

fn setup_bridge<'a>(env: &Env) -> (Address, FiatBridgeClient<'a>, Address) {
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

/// Read the data map of the most recent event emitted by the bridge.
fn last_event_field(env: &Env, contract_id: &Address, field: &str) -> Option<ScVal> {
    let events = env.events().all().filter_by_contract(contract_id);
    let raw = events.events();
    let event = raw.last()?;
    let ContractEventBody::V0(body) = &event.body;
    match &body.data {
        ScVal::Map(Some(map)) => map.iter().find_map(|entry| {
            let key = ScVal::Symbol(ScSymbol(StringM::try_from(field).ok()?));
            (entry.key == key).then(|| entry.val.clone())
        }),
        _ => None,
    }
}

fn last_event_bool(env: &Env, contract_id: &Address, field: &str) -> Option<bool> {
    match last_event_field(env, contract_id, field) {
        Some(ScVal::Bool(b)) => Some(b),
        _ => None,
    }
}

fn last_event_u32(env: &Env, contract_id: &Address, field: &str) -> Option<u32> {
    match last_event_field(env, contract_id, field) {
        Some(ScVal::U32(v)) => Some(v),
        _ => None,
    }
}

fn bridge_event_count(env: &Env, contract_id: &Address) -> usize {
    env.events()
        .all()
        .filter_by_contract(contract_id)
        .events()
        .len()
}

/// Read `DeniedCount` directly out of instance storage, bypassing the
/// contract's own methods, so mutation assertions don't depend on the
/// correctness of the thing being tested.
fn denied_count(env: &Env, contract_id: &Address) -> u64 {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0)
    })
}

#[test]
fn is_denied_false_for_never_denied_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let stranger = Address::generate(&env);

    assert!(!bridge.is_denied(&stranger));
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
}

#[test]
fn is_denied_true_immediately_after_deny_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let target = Address::generate(&env);

    bridge.deny_address(&target);

    assert!(bridge.is_denied(&target));
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(true));
}

#[test]
fn is_denied_false_immediately_after_remove_denied_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let target = Address::generate(&env);

    bridge.deny_address(&target);
    assert!(bridge.is_denied(&target));

    bridge.remove_denied_address(&target);

    assert!(!bridge.is_denied(&target));
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
}

/// The lookup tracks each address independently: denying one address must
/// never flip another's answer.
#[test]
fn is_denied_tracks_each_address_independently() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let denied = Address::generate(&env);
    let clean = Address::generate(&env);

    bridge.deny_address(&denied);

    assert!(bridge.is_denied(&denied));
    assert!(!bridge.is_denied(&clean));
}

/// A read-only query must never mutate the denylist it's reading — the
/// answer and the underlying counter stay identical across repeated calls.
#[test]
fn is_denied_never_mutates_denylist_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let target = Address::generate(&env);
    bridge.deny_address(&target);

    let count_before = denied_count(&env, &contract_id);

    for _ in 0..5 {
        assert!(bridge.is_denied(&target));
    }

    assert_eq!(denied_count(&env, &contract_id), count_before);
}

/// Every call emits, is not deduplicated, and reports the address actually
/// queried rather than some other one.
#[test]
fn every_query_emits_an_event_naming_the_queried_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let denied = Address::generate(&env);
    let queried = Address::generate(&env);
    bridge.deny_address(&denied);

    bridge.is_denied(&queried);
    assert_eq!(bridge_event_count(&env, &contract_id), 1);

    let logged = last_event_field(&env, &contract_id, "address");
    let expected: ScVal = ScVal::from(&queried);
    assert_eq!(logged, Some(expected));

    bridge.is_denied(&queried);
    assert_eq!(bridge_event_count(&env, &contract_id), 1);
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
}

#[test]
fn event_carries_event_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let target = Address::generate(&env);

    bridge.is_denied(&target);

    assert_eq!(
        last_event_u32(&env, &contract_id, "version"),
        Some(EVENT_VERSION)
    );
}

/// The query requires no prior `init` call — it reads a per-address key
/// that's simply absent on a fresh contract, so it must report `false` and
/// still emit, not panic.
#[test]
fn works_on_an_uninitialised_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let stranger = Address::generate(&env);

    assert!(!bridge.is_denied(&stranger));

    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
    assert_eq!(
        last_event_u32(&env, &contract_id, "version"),
        Some(EVENT_VERSION)
    );
}

/// The doc comment on `is_denied` promises `Error::Overflow` rather than a
/// panic once `DeniedCount` has reached `u64::MAX`. `deny_address` itself
/// makes that state practically unreachable through the public API (it
/// would take `u64::MAX` calls), so the count is set directly via storage
/// to exercise the guard, matching the direct-storage-manipulation pattern
/// already used elsewhere in this test suite (see `test_issue_676.rs`).
#[test]
fn overflow_guard_returns_error_instead_of_panicking() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let target = Address::generate(&env);

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::DeniedCount, &u64::MAX);
    });

    let result = bridge.try_is_denied(&target);
    assert_eq!(result, Err(Ok(Error::Overflow)));
}
