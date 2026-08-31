//! Unit tests for the `IsOperatorCheckedEvent` emission added to
//! `is_operator`.
//!
//! `is_operator` is an access-control lookup with no state transition of its
//! own, so the emission follows the precedent already set by `is_denied` and
//! `IsDeniedCheckedEvent`: the event records which address was checked and what
//! the contract answered, giving the operator-role query the same audit trail
//! the denylist query already has.
//!
//! These tests pin down that the event fires on both answers, names the address
//! that was actually queried, versions itself with `EVENT_VERSION`, and that
//! the query still reports the truth after every operator transition.

use crate::{FiatBridge, FiatBridgeClient, EVENT_VERSION};
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

/// A query against a registered operator emits an event reporting `true`.
#[test]
fn positive_check_emits_event_with_true_result() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);

    assert!(bridge.is_operator(&operator));

    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(true));
}

/// A query against an unknown address emits an event reporting `false`, so the
/// negative answer is audited just as the positive one is.
#[test]
fn negative_check_emits_event_with_false_result() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let stranger = Address::generate(&env);

    assert!(!bridge.is_operator(&stranger));

    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
}

/// The event is versioned with `EVENT_VERSION`, matching every other bridge
/// event. With `#[contractevent]` the struct name is the topic and `version`
/// travels in the data map, which is the convention the existing
/// `assert_bridge_events_have_version` helper in `test.rs` asserts against.
#[test]
fn event_carries_event_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    bridge.is_operator(&operator);

    assert_eq!(
        last_event_u32(&env, &contract_id, "version"),
        Some(EVENT_VERSION)
    );
}

/// The event names the address that was actually queried, not some other
/// operator, so the audit trail is attributable.
#[test]
fn event_names_the_queried_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let registered = Address::generate(&env);
    let queried = Address::generate(&env);
    bridge.set_operator(&registered, &true, &0);

    bridge.is_operator(&queried);

    let logged = last_event_field(&env, &contract_id, "operator");
    let expected: ScVal = ScVal::from(&queried);
    assert_eq!(logged, Some(expected));
}

/// Every query emits: the check is not deduplicated or suppressed for repeats.
#[test]
fn every_query_emits_an_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true, &0);

    // The event buffer holds the most recent invocation, so a non-empty buffer
    // after each call means that call emitted.
    bridge.is_operator(&operator);
    assert_eq!(bridge_event_count(&env, &contract_id), 1);

    bridge.is_operator(&operator);
    assert_eq!(bridge_event_count(&env, &contract_id), 1);
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(true));
}

/// The reported result tracks the operator lifecycle: false before
/// registration, true after, false again after deactivation.
#[test]
fn reported_result_tracks_operator_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);
    let operator = Address::generate(&env);

    assert!(!bridge.is_operator(&operator));
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));

    bridge.set_operator(&operator, &true, &0);
    assert!(bridge.is_operator(&operator));
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(true));

    bridge.set_operator(&operator, &false, &1);
    assert!(!bridge.is_operator(&operator));
    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
}

/// The emission does not disturb the operator registry: the answer is stable
/// across repeated queries and the address is not enrolled as a side effect.
#[test]
fn emission_does_not_mutate_the_operator_registry() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin) = setup_bridge(&env);
    let stranger = Address::generate(&env);

    for _ in 0..5 {
        assert!(!bridge.is_operator(&stranger));
    }

    // A query never enrols the queried address.
    assert!(!bridge.is_operator(&stranger));
}

/// The query works, and emits, on an uninitialised contract too: it reads a
/// per-address key that simply is not present, so the answer is false.
#[test]
fn uninitialised_contract_reports_false_and_emits() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let stranger = Address::generate(&env);

    assert!(!bridge.is_operator(&stranger));

    assert_eq!(last_event_bool(&env, &contract_id, "result"), Some(false));
    assert_eq!(
        last_event_u32(&env, &contract_id, "version"),
        Some(EVENT_VERSION)
    );
}
