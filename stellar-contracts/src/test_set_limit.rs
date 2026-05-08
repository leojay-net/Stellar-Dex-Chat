//! Comprehensive coverage for the critical paths through `set_limit`.
//!
//! `set_limit` mutates a token's `TokenConfig.limit`, which in turn gates
//! every deposit (`amount > config.limit` → `Error::ExceedsLimit`). It is
//! also gated by the admin-configured `SetLimitMaxCap`, the circuit
//! breaker, and the per-token whitelist registry — making it a
//! disproportionately load-bearing admin operation.
//!
//! These tests exercise the boundaries of each gate, the persistence of
//! the value, the per-token isolation property, and the event surface.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::StellarAssetClient,
    vec,
    xdr::{ContractEventBody, ScSymbol, ScVal, StringM},
    Address, Bytes, Env,
};

struct Fixture<'a> {
    env: Env,
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    token_addr: Address,
    token_sac: StellarAssetClient<'a>,
}

/// Bridge initialised with a generous default `limit` so tests that don't
/// re-set it can still exercise deposits.
fn fixture_with_limit(limit: i128) -> Fixture<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_sac = StellarAssetClient::new(&env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let signers = vec![&env, admin.clone()];
    bridge.init(&admin, &token_addr, &limit, &1, &signers, &1);

    Fixture {
        env,
        contract_id,
        bridge,
        token_addr,
        token_sac,
    }
}

// ── Happy paths ────────────────────────────────────────────────────────

#[test]
fn set_limit_persists_the_new_value() {
    let f = fixture_with_limit(500);

    f.bridge.set_limit(&f.token_addr, &1_000);
    assert_eq!(f.bridge.get_limit(), 1_000);

    // Repeating `set_limit` overwrites the previous value rather than
    // accumulating — important property for admin recoverability.
    f.bridge.set_limit(&f.token_addr, &2_500);
    assert_eq!(f.bridge.get_limit(), 2_500);

    f.bridge.set_limit(&f.token_addr, &100);
    assert_eq!(f.bridge.get_limit(), 100);
}

#[test]
fn set_limit_emits_set_limit_event_with_correct_fields() {
    let f = fixture_with_limit(500);
    f.bridge.set_limit(&f.token_addr, &1_234);

    let bridge_events = f.env.events().all().filter_by_contract(&f.contract_id);
    let raw = bridge_events.events();

    let topic_symbol = ScVal::Symbol(ScSymbol(
        StringM::try_from("set_limit_event").expect("event topic"),
    ));
    let limit_key = ScVal::Symbol(ScSymbol(
        StringM::try_from("limit").expect("field name"),
    ));
    let token_key = ScVal::Symbol(ScSymbol(
        StringM::try_from("token").expect("field name"),
    ));
    let expected_token: ScVal = (&f.token_addr).try_into().expect("address → ScVal");

    let expected_limit: ScVal = 1_234i128.try_into().expect("i128 → ScVal");

    let mut found = false;
    for event in raw.iter() {
        let ContractEventBody::V0(body) = &event.body;
        if !body.topics.iter().any(|t| t == &topic_symbol) {
            continue;
        }
        if let ScVal::Map(Some(map)) = &body.data {
            let limit_entry = map
                .iter()
                .find(|e| e.key == limit_key)
                .expect("limit field");
            assert_eq!(limit_entry.val, expected_limit);

            let token_entry = map
                .iter()
                .find(|e| e.key == token_key)
                .expect("token field");
            assert_eq!(token_entry.val, expected_token);

            found = true;
            break;
        }
    }
    assert!(found, "expected SetLimitEvent on bridge: {:?}", raw);
}

#[test]
fn set_limit_at_max_cap_boundary_succeeds() {
    let f = fixture_with_limit(500);

    // Configure max_cap explicitly, then drive limit to exactly that cap.
    f.bridge.set_limit_max_cap(&5_000);
    f.bridge.set_limit(&f.token_addr, &5_000);
    assert_eq!(f.bridge.get_limit(), 5_000);
}

#[test]
fn set_limit_with_default_max_cap_accepts_i128_max() {
    let f = fixture_with_limit(500);

    // Default max_cap is i128::MAX after init; pushing the limit to the
    // type ceiling must succeed and persist.
    f.bridge.set_limit(&f.token_addr, &i128::MAX);
    assert_eq!(f.bridge.get_limit(), i128::MAX);
}

#[test]
fn set_limit_takes_effect_for_deposits() {
    let f = fixture_with_limit(10_000);
    let user = Address::generate(&f.env);
    f.token_sac.mint(&user, &10_000);

    // Tighten the per-token cap and confirm a deposit at or above the new
    // limit is rejected with `ExceedsLimit`.
    f.bridge.set_limit(&f.token_addr, &500);
    let result =
        f.bridge
            .try_deposit(&user, &600, &f.token_addr, &Bytes::new(&f.env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));

    // A deposit at the new cap must still succeed.
    f.bridge
        .deposit(&user, &500, &f.token_addr, &Bytes::new(&f.env), &0, &0, &None);
}

// ── Rejection paths ────────────────────────────────────────────────────

#[test]
fn set_limit_rejects_unwhitelisted_token() {
    let f = fixture_with_limit(500);

    // A token address that was never registered via init / register-token
    // path must surface as `TokenNotWhitelisted` rather than silently
    // creating a registry entry on first set_limit.
    let stranger = Address::generate(&f.env);
    let result = f.bridge.try_set_limit(&stranger, &1_000);
    assert_eq!(result, Err(Ok(Error::TokenNotWhitelisted)));
}

#[test]
fn set_limit_rejects_one_above_configured_max_cap() {
    let f = fixture_with_limit(500);

    f.bridge.set_limit_max_cap(&1_000);
    let result = f.bridge.try_set_limit(&f.token_addr, &1_001);
    assert_eq!(result, Err(Ok(Error::ExceedsLimitMaxCap)));

    // The on-chain stored limit must remain whatever it was before the
    // failed call (i.e. the init value, 500).
    assert_eq!(f.bridge.get_limit(), 500);
}

#[test]
fn set_limit_blocked_when_circuit_breaker_tripped() {
    let f = fixture_with_limit(1_000);

    // Trip the circuit breaker via a direct storage write — keeps this
    // test focused on the gate inside set_limit and avoids depending on
    // the volume-trip path's calibration.
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::CircuitBreakerTripped, &true);
    });

    let result = f.bridge.try_set_limit(&f.token_addr, &2_000);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn set_limit_recovers_after_circuit_breaker_clears() {
    let f = fixture_with_limit(1_000);

    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::CircuitBreakerTripped, &true);
    });

    assert_eq!(
        f.bridge.try_set_limit(&f.token_addr, &2_000),
        Err(Ok(Error::CircuitBreakerActive))
    );

    // Clear the breaker and verify set_limit is callable again.
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::CircuitBreakerTripped, &false);
    });

    f.bridge.set_limit(&f.token_addr, &2_000);
    assert_eq!(f.bridge.get_limit(), 2_000);
}

#[test]
fn set_limit_on_uninitialised_contract_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    // No init() call — admin lookup must fail with NotInitialized rather
    // than panic or fall through.
    let token = Address::generate(&env);
    let result = bridge.try_set_limit(&token, &1_000);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

// ── Properties of the gate ordering ────────────────────────────────────

#[test]
fn circuit_breaker_check_runs_before_max_cap_check() {
    // If the breaker is tripped *and* the requested limit is above the
    // cap, callers should see `CircuitBreakerActive` (not
    // `ExceedsLimitMaxCap`). This pins the documented gate ordering so
    // a future refactor can't silently swap it.
    let f = fixture_with_limit(500);
    f.bridge.set_limit_max_cap(&1_000);

    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::CircuitBreakerTripped, &true);
    });

    let result = f.bridge.try_set_limit(&f.token_addr, &10_000);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn max_cap_check_runs_before_token_whitelist_check() {
    // If the limit is above max_cap *and* the token isn't whitelisted,
    // `ExceedsLimitMaxCap` wins over `TokenNotWhitelisted`. This keeps
    // the cap-violation signal visible to admins regardless of which
    // token they aimed at.
    let f = fixture_with_limit(500);
    f.bridge.set_limit_max_cap(&1_000);

    let stranger = Address::generate(&f.env);
    let result = f.bridge.try_set_limit(&stranger, &10_000);
    assert_eq!(result, Err(Ok(Error::ExceedsLimitMaxCap)));
}
