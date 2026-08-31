//! Unit tests for the `SetMaxOperatorsEvent` emission added to
//! `set_max_operators`.
//!
//! `set_max_operators` mutates `DataKey::MaxOperators` but historically emitted
//! nothing, so the new cap was invisible to indexers. These tests pin the
//! emission down: it fires on every accepted call, it carries the full
//! transition (previous cap, new cap, live operator count), it versions itself
//! with `EVENT_VERSION` the way every other bridge event does, and it stays
//! silent on the rejected paths.

use crate::{Error, FiatBridge, FiatBridgeClient, EVENT_VERSION};
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

/// Look up a `u32` field by name in the data map of the most recent event
/// emitted by the bridge.
fn last_event_u32_field(env: &Env, contract_id: &Address, field: &str) -> Option<u32> {
    let events = env.events().all().filter_by_contract(contract_id);
    let raw = events.events();
    let event = raw.last()?;
    let ContractEventBody::V0(body) = &event.body;
    match &body.data {
        ScVal::Map(Some(map)) => map.iter().find_map(|entry| {
            let key = ScVal::Symbol(ScSymbol(StringM::try_from(field).ok()?));
            if entry.key == key {
                match entry.val {
                    ScVal::U32(v) => Some(v),
                    _ => None,
                }
            } else {
                None
            }
        }),
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

/// A successful call emits the event, and the event carries the new cap.
#[test]
fn set_max_operators_emits_event_with_new_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    bridge.set_max_operators(&7);

    assert_eq!(
        last_event_u32_field(&env, &contract_id, "max_operators"),
        Some(7)
    );
}

/// The event is versioned with `EVENT_VERSION`, matching every other bridge
/// event. With `#[contractevent]` the struct name is the topic and `version`
/// travels in the data map, which is the convention the existing
/// `assert_bridge_events_have_version` helper in `test.rs` asserts against.
#[test]
fn set_max_operators_event_carries_event_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    bridge.set_max_operators(&5);

    assert_eq!(
        last_event_u32_field(&env, &contract_id, "version"),
        Some(EVENT_VERSION)
    );
}

/// The event reports the outgoing cap, so an indexer can reconstruct the whole
/// transition without replaying storage. The first call reports 0, the
/// "unlimited" sentinel for an unconfigured cap.
#[test]
fn event_reports_previous_cap_across_successive_changes() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    // No cap configured yet, so `previous` is the 0 sentinel.
    bridge.set_max_operators(&4);
    assert_eq!(last_event_u32_field(&env, &contract_id, "previous"), Some(0));
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "max_operators"),
        Some(4)
    );

    bridge.set_max_operators(&9);
    assert_eq!(last_event_u32_field(&env, &contract_id, "previous"), Some(4));
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "max_operators"),
        Some(9)
    );

    bridge.set_max_operators(&2);
    assert_eq!(last_event_u32_field(&env, &contract_id, "previous"), Some(9));
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "max_operators"),
        Some(2)
    );
}

/// The event carries the live operator count alongside the cap.
#[test]
fn event_reports_active_operator_count() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    // No operators registered yet.
    bridge.set_max_operators(&5);
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "active_operators"),
        Some(0)
    );

    bridge.set_operator(&Address::generate(&env), &true, &0);
    bridge.set_operator(&Address::generate(&env), &true, &0);

    bridge.set_max_operators(&6);
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "active_operators"),
        Some(2)
    );
}

/// Setting the cap to 0 (unlimited) is an accepted state change, so it emits.
#[test]
fn setting_unlimited_cap_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    bridge.set_max_operators(&3);
    bridge.set_max_operators(&0);

    assert_eq!(last_event_u32_field(&env, &contract_id, "previous"), Some(3));
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "max_operators"),
        Some(0)
    );
}

/// Re-setting the same value is still an accepted call, so it still emits: the
/// event records the call, and `previous == max_operators` makes the no-op
/// visible to consumers.
#[test]
fn idempotent_call_still_emits_with_equal_previous_and_new() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    bridge.set_max_operators(&8);
    bridge.set_max_operators(&8);

    // The event buffer holds the most recent invocation, so a non-empty buffer
    // here means the repeat call emitted rather than silently doing nothing.
    assert_eq!(bridge_event_count(&env, &contract_id), 1);
    assert_eq!(last_event_u32_field(&env, &contract_id, "previous"), Some(8));
    assert_eq!(
        last_event_u32_field(&env, &contract_id, "max_operators"),
        Some(8)
    );
}

/// A rejected call emits nothing and does not move the stored cap: the
/// rejection path performs no partial mutation.
#[test]
fn rejected_call_emits_nothing_and_leaves_cap_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin) = setup_bridge(&env);

    bridge.set_operator(&Address::generate(&env), &true, &0);
    bridge.set_operator(&Address::generate(&env), &true, &0);
    bridge.set_operator(&Address::generate(&env), &true, &0);

    bridge.set_max_operators(&5);

    // 3 operators are active, so a cap of 1 must be refused.
    let result = bridge.try_set_max_operators(&1);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));

    // The event buffer holds the most recent invocation only, so an empty
    // buffer means the rejected call emitted nothing at all.
    assert_eq!(bridge_event_count(&env, &contract_id), 0);

    // The cap did not move: a later valid change still reports 5 as previous.
    bridge.set_max_operators(&6);
    assert_eq!(last_event_u32_field(&env, &contract_id, "previous"), Some(5));
}

/// An uninitialised contract rejects the call before any emission.
#[test]
fn uninitialised_contract_emits_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let result = bridge.try_set_max_operators(&5);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));

    assert_eq!(bridge_event_count(&env, &contract_id), 0);
}
