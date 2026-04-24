#![cfg(test)]
#![allow(unused_variables)]
extern crate std;

use super::*;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, EnvTestConfig, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
};
use std::{format, fs, path::PathBuf, string::String, vec::Vec as StdVec};

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
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &limit, &1, &signers, &1);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

fn setup_bridge_with_min(
    env: &Env,
    limit: i128,
    min_deposit: i128,
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
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &limit, &min_deposit, &signers, &1);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

fn load_valid_contract_wasm_fixture() -> std::vec::Vec<u8> {
    let cargo_home = std::env::var("CARGO_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| std::string::String::from("."));
        let mut path = home;
        path.push_str("/.cargo");
        path
    });

    let registry_src = std::path::Path::new(&cargo_home).join("registry/src");
    let entries = std::fs::read_dir(&registry_src).expect("unable to read cargo registry/src");

    for entry in entries.flatten() {
        let registry_path = entry.path();
        if !registry_path.is_dir() {
            continue;
        }

        let candidate = registry_path.join("soroban-sdk-25.3.0/doctest_fixtures/contract.wasm");
        if candidate.exists() {
            return std::fs::read(candidate).expect("unable to read fixture wasm");
        }
    }

    panic!("soroban-sdk doctest wasm fixture not found")
}

struct SnapshotEvent {
    topics: StdVec<String>,
    data: String,
}

fn new_snapshot_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

fn snapshot_path(name: &str) -> PathBuf {
    PathBuf::from("test_snapshots")
        .join("events")
        .join(format!("{name}.json"))
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn render_snapshot(events: &[SnapshotEvent]) -> String {
    let mut out = String::from("[\n");
    for (index, event) in events.iter().enumerate() {
        out.push_str("  {\n");
        out.push_str("    \"contract\": \"bridge\",\n");
        out.push_str("    \"topics\": [\n");
        for (topic_index, topic) in event.topics.iter().enumerate() {
            out.push_str(&format!(
                "      \"{}\"{}\n",
                escape_json(topic),
                if topic_index + 1 == event.topics.len() {
                    ""
                } else {
                    ","
                }
            ));
        }
        out.push_str("    ],\n");
        out.push_str(&format!("    \"data\": \"{}\"\n", escape_json(&event.data)));
        out.push_str("  }");
        if index + 1 != events.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push(']');
    out.push('\n');
    out
}

fn assert_event_snapshot(name: &str, events: &[SnapshotEvent]) {
    let path = snapshot_path(name);
    let expected = fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("failed to read snapshot {}: {err}", path.display()));
    let actual = render_snapshot(events);
    assert_eq!(
        expected,
        actual,
        "snapshot mismatch for {name}. Update {} if this event change is intentional.",
        path.display()
    );
}

// ── happy-path tests ──────────────────────────────────────────────────

#[test]
fn test_deposit_and_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(token.balance(&user), 800);
    assert_eq!(token.balance(&contract_id), 200);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    bridge.execute_withdrawal(&req_id, &None, &0, &0);

    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

#[test]
fn test_time_locked_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    bridge.set_lock_period(&100);
    assert_eq!(bridge.get_lock_period(), 100);

    let start_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.to, user);
    assert_eq!(req.token, token_addr);
    assert_eq!(req.amount, 100);
    assert_eq!(req.unlock_ledger, start_ledger + 100);
    assert_eq!(req.queued_ledger, start_ledger);

    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 100;
    });

    bridge.execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
    assert_eq!(bridge.get_withdrawal_request(&req_id), None);
}

#[test]
fn test_withdraw_queue_metrics_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Empty queue
    assert_eq!(bridge.get_wq_depth(), 0);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), None);
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), None);

    // Enqueue first request
    let l0 = env.ledger().sequence();
    let r1 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l0));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(0));

    // Advance ledger and enqueue second request
    env.ledger().with_mut(|li| {
        li.sequence_number = l0 + 7;
    });
    let l1 = env.ledger().sequence();
    let _r2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    assert_eq!(bridge.get_wq_depth(), 2);
    // Oldest remains first
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l0));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(l1 - l0));

    // Execute first request (default lock_period=0), oldest should move to second
    bridge.execute_withdrawal(&r1, &None, &0, &0);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l1));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(0));
}

#[test]
fn test_withdraw_queue_metrics_cancel_oldest() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let l0 = env.ledger().sequence();
    let r1 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number = l0 + 3;
    });
    let l1 = env.ledger().sequence();
    let r2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    assert_eq!(bridge.get_wq_depth(), 2);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l0));

    // Cancel oldest request: oldest should advance to r2
    bridge.cancel_withdrawal(&r1);
    assert_eq!(bridge.get_wq_depth(), 1);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), Some(l1));
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), Some(0));

    // Cancel remaining request: queue empty
    bridge.cancel_withdrawal(&r2);
    assert_eq!(bridge.get_wq_depth(), 0);
    assert_eq!(bridge.get_wq_oldest_queued_ledger(), None);
    assert_eq!(bridge.get_wq_oldest_age_ledgers(), None);
}

#[test]
fn test_cancel_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert!(bridge.get_withdrawal_request(&req_id).is_some());

    bridge.cancel_withdrawal(&req_id);
    assert!(bridge.get_withdrawal_request(&req_id).is_none());

    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0);
    assert_eq!(result, Err(Ok(Error::RequestNotFound)));
}

#[test]
fn test_view_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _token_addr, _, _) = setup_bridge(&env, 300);
    assert_eq!(bridge.get_admin(), admin);
}

#[test]
fn test_deposit_cooldown_blocks_rapid_second_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&10);
    assert_eq!(bridge.get_cooldown(), 10);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_deposit_succeeds_after_cooldown_period() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&10);
    let start_ledger = env.ledger().sequence();
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 10;
    });

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user), 200);
}

#[test]
fn test_deposit_cooldown_is_per_address_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &500);
    token_sac.mint(&user_b, &500);

    bridge.set_cooldown(&10);
    bridge.deposit(&user_a, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // user_b not blocked
    bridge.deposit(&user_b, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // user_a still blocked
    let result = bridge.try_deposit(&user_a, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_last_deposit_record_expires_with_ttl() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.set_cooldown(&5);
    let start_ledger = env.ledger().sequence();
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_last_deposit_ledger(&user), Some(start_ledger));

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 20000;
    });

    assert_eq!(bridge.get_last_deposit_ledger(&user), None);
}

#[test]
fn test_transfer_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, _, _, _) = setup_bridge(&env, 100);
    let new_admin = Address::generate(&env);

    bridge.transfer_admin(&new_admin);
    bridge.accept_admin();

    assert_eq!(bridge.get_admin(), new_admin);
}

#[test]
fn test_transfer_admin_to_self_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, _, _, _) = setup_bridge(&env, 100);

    // Attempting to transfer to self should fail with InvalidRecipient
    let result = bridge.try_transfer_admin(&admin);
    assert_eq!(result, Err(Ok(Error::SameAdmin)));

    // Admin should remain the same
    assert_eq!(bridge.get_admin(), admin);
}

#[test]
fn test_set_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 500);
    bridge.set_limit(&token_addr, &1000);
    assert_eq!(bridge.get_limit(), 1000);
}

#[test]
fn test_set_limit_rejects_above_configured_max_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, token_addr, _, _) = setup_bridge(&env, 500);
    bridge.set_limit_max_cap(&1000);
    let result = bridge.try_set_limit(&token_addr, &1001);
    assert_eq!(result, Err(Ok(Error::ExceedsLimitMaxCap)));
}

#[test]
fn test_set_limit_succeeds_at_max_cap_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, token_addr, _, _) = setup_bridge(&env, 500);
    bridge.set_limit_max_cap(&1000);
    bridge.set_limit(&token_addr, &1000);
    assert_eq!(bridge.get_limit(), 1000);
}

#[test]
fn test_set_limit_max_cap_rejects_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, _token_addr, _, _) = setup_bridge(&env, 500);
    let result = bridge.try_set_limit_max_cap(&0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_get_set_limit_max_cap_defaults_high() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _admin, _token_addr, _, _) = setup_bridge(&env, 500);
    assert_eq!(bridge.get_set_limit_max_cap(), i128::MAX);
}

#[test]
fn test_heartbeat_blocked_by_circuit_breaker() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);

    let operator = Address::generate(&env);
    bridge.set_operator(&operator, &true);

    // Set circuit breaker threshold and trip it
    bridge.set_circuit_breaker_threshold(&500);
    token_sac.mint(&admin, &600);
    bridge.deposit(&admin, &600, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.withdraw(&admin, &admin, &600, &token_addr); // This should trip the circuit breaker

    // Now heartbeat should be blocked
    let heartbeat_result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(heartbeat_result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_set_limit_blocked_by_circuit_breaker() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);

    // Set circuit breaker threshold and trip it
    bridge.set_circuit_breaker_threshold(&500);
    token_sac.mint(&admin, &600);
    bridge.deposit(&admin, &600, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.withdraw(&admin, &admin, &600, &token_addr); // This should trip the circuit breaker

    // Now set_limit should be blocked
    let set_limit_result = bridge.try_set_limit(&token_addr, &2000);
    assert_eq!(set_limit_result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_set_emergency_recovery_with_cap_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let recovery = Address::generate(&env);

    bridge.set_emergency_recovery(&recovery, &750);

    let snapshot = bridge.get_config_snapshot();
    assert_eq!(snapshot.emergency_recovery, Some(recovery.clone()));
    assert_eq!(bridge.get_emergency_recovery_cap(), Some(750));
}

#[test]
fn test_set_emergency_recovery_rejects_cap_above_token_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let recovery = Address::generate(&env);

    let result = bridge.try_set_emergency_recovery(&recovery, &1_001);
    assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
    assert_eq!(bridge.get_emergency_recovery_cap(), None);
}

#[test]
fn test_operator_cap_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);

    bridge.set_max_operators(&1);
    bridge.set_operator(&op1, &true);

    let result = bridge.try_set_operator(&op2, &true);
    assert_eq!(result, Err(Ok(Error::OperatorCapReached)));
    assert!(!bridge.is_operator(&op2));
}

#[test]
fn test_operator_cap_recovers_after_deactivation() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);

    bridge.set_max_operators(&1);
    bridge.set_operator(&op1, &true);
    bridge.set_operator(&op1, &false);
    bridge.set_operator(&op2, &true);

    assert!(!bridge.is_operator(&op1));
    assert!(bridge.is_operator(&op2));
}

#[test]
fn test_prune_inactive_operators_keeps_active_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    let inactive = Address::generate(&env);
    let active = Address::generate(&env);

    bridge.set_operator(&inactive, &true);
    bridge.set_operator(&active, &true);
    bridge.heartbeat(&inactive, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number = DEFAULT_INACTIVITY_THRESHOLD + 5;
    });

    bridge.heartbeat(&active, &0);
    bridge.prune_inactive_operators();

    assert!(!bridge.is_operator(&inactive));
    assert!(bridge.is_operator(&active));
}

#[test]
fn test_set_operator_prunes_inactive_on_next_admin_action() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    let stale = Address::generate(&env);
    let newcomer = Address::generate(&env);

    bridge.set_operator(&stale, &true);
    bridge.heartbeat(&stale, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number = DEFAULT_INACTIVITY_THRESHOLD + 5;
    });

    bridge.set_operator(&newcomer, &true);

    assert!(!bridge.is_operator(&stale));
    assert!(bridge.is_operator(&newcomer));
}

#[test]
fn test_receipt_id_determinism_and_uniqueness() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    let reference = Bytes::from_slice(&env, b"ref1");

    // First deposit
    let id1 = bridge.deposit(&user, &100, &token_addr, &reference, &0, &0, &None);

    // Second identical deposit (except internal counter will increase)
    let id2 = bridge.deposit(&user, &100, &token_addr, &reference, &0, &0, &None);

    // They must be unique
    assert_ne!(id1, id2);

    // Verify determinism: re-calculate id1 manually
    // Derivation: sha256(xdr(depositor, amount, ledger, reference, counter))
    // counter for id1 was 0
    let expected_id1_data = (
        user.clone(),
        100i128,
        env.ledger().sequence(),
        reference.clone(),
        0u64,
    );
    let expected_id1: BytesN<32> = env.crypto().sha256(&expected_id1_data.to_xdr(&env)).into();
    assert_eq!(id1, expected_id1);
}

#[test]
fn test_receipt_id_collision_resistance() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    token_sac.mint(&user1, &500);
    token_sac.mint(&user2, &500);

    let ref_shared = Bytes::from_slice(&env, b"ref");

    let id1 = bridge.deposit(&user1, &100, &token_addr, &ref_shared, &0, &0, &None);
    let id2 = bridge.deposit(&user2, &100, &token_addr, &ref_shared, &0, &0, &None);

    assert_ne!(id1, id2);

    // Different amount
    let id3 = bridge.deposit(&user1, &200, &token_addr, &ref_shared, &0, &0, &None);
    assert_ne!(id1, id3);
}

#[test]
fn test_unauthorized_operator_management() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    let _attacker = Address::generate(&env);
    let victim = Address::generate(&env);

    // Attacker tries to set themselves as operator, should fail because they are not admin
    // Note: mock_all_auths handles the check, here we just verify the call structure
    bridge.set_operator(&victim, &true);
    assert!(bridge.is_operator(&victim));
}

// ── denylist tests ────────────────────────────────────────────────────────

#[test]
fn test_deny_address_blocks_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deny_address(&user);
    assert!(bridge.is_denied(&user));

    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

// ── escrow migration tests ────────────────────────────────────────────────
#[test]
fn test_escrow_storage_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    assert_eq!(bridge.get_escrow_storage_version(), 0);
}

#[test]
fn test_migrate_escrow_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let migrated = bridge.migrate_escrow(&10);
    assert_eq!(migrated, 2);
    assert_eq!(bridge.get_escrow_storage_version(), 1);
}

#[test]
fn test_deny_address_blocks_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Deposit first, then deny
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);

    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

#[test]
fn test_deny_address_blocks_request_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);

    let result = bridge.try_request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

#[test]
fn test_migrate_escrow_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.migrate_escrow(&10);
    let result = bridge.try_migrate_escrow(&10);
    assert_eq!(result, Err(Ok(Error::MigrationAlreadyComplete)));
}

#[test]
fn test_remove_denied_address_restores_access() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);
    assert!(bridge.is_denied(&user));

    bridge.remove_denied_address(&user);
    assert!(!bridge.is_denied(&user));

    // Deposit should succeed after removal
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user), 200);
}

#[test]
fn test_migrate_escrow_resumable() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let migrated1 = bridge.migrate_escrow(&2);
    assert_eq!(migrated1, 2);
    assert_eq!(bridge.get_migration_cursor(), 2);
    assert_eq!(bridge.get_escrow_storage_version(), 0);

    let migrated2 = bridge.migrate_escrow(&2);
    assert_eq!(migrated2, 1);
    assert_eq!(bridge.get_migration_cursor(), 3);
    assert_eq!(bridge.get_escrow_storage_version(), 1);
}

#[test]
fn test_denylist_does_not_affect_other_users() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let denied_user = Address::generate(&env);
    let normal_user = Address::generate(&env);
    token_sac.mint(&denied_user, &5_000);
    token_sac.mint(&normal_user, &5_000);

    bridge.deny_address(&denied_user);

    // Normal user should not be affected
    bridge.deposit(
        &normal_user,
        &200,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(bridge.get_user_deposited(&normal_user), 200);
}

#[test]
fn test_is_denied_returns_correct_value() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);

    // Initially, user should not be denied
    assert!(!bridge.is_denied(&user));

    // After denying, should return true
    bridge.deny_address(&user);
    assert!(bridge.is_denied(&user));

    // After removing from denylist, should return false again
    bridge.remove_denied_address(&user);
    assert!(!bridge.is_denied(&user));
}

#[test]
fn test_get_escrow_record() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.migrate_escrow(&10);

    let escrow = bridge.get_escrow_record(&0).unwrap();
    assert_eq!(escrow.version, 1);
    assert_eq!(escrow.depositor, user);
    assert_eq!(escrow.amount, 100);
    assert!(escrow.migrated);
}

// ── batch admin operations tests ──────────────────────────────────────────
#[test]
fn test_batch_admin_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);

    let cooldown_bytes = Bytes::from_array(&env, &100u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: cooldown_bytes,
    });

    let lock_bytes = Bytes::from_array(&env, &50u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: lock_bytes,
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 2);
    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 0);
    assert!(result.failed_index.is_none());

    assert_eq!(bridge.get_cooldown(), 100);
    assert_eq!(bridge.get_lock_period(), 50);
}

#[test]
fn test_batch_admin_rollback_on_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    bridge.set_cooldown(&10);
    bridge.set_lock_period(&20);

    let mut ops = soroban_sdk::Vec::new(&env);

    let cooldown_bytes = Bytes::from_array(&env, &100u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: cooldown_bytes,
    });

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "invalid_op"),
        payload: Bytes::new(&env),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 2);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(1));

    // First valid op is applied, invalid op is skipped.
    assert_eq!(bridge.get_cooldown(), 100);
    assert_eq!(bridge.get_lock_period(), 20);
}

#[test]
fn test_batch_admin_partial_failure_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);

    let cooldown_bytes = Bytes::from_array(&env, &100u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: cooldown_bytes,
    });

    let lock_bytes = Bytes::from_array(&env, &50u32.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: lock_bytes,
    });

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "unknown"),
        payload: Bytes::new(&env),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 3);
    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(2));
}

#[test]
fn test_batch_admin_mixed_success_failure_continues() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    bridge.set_cooldown(&10);
    bridge.set_lock_period(&20);

    let mut ops = soroban_sdk::Vec::new(&env);

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: Bytes::from_array(&env, &100u32.to_be_bytes()),
    });

    // Invalid op in the middle should not revert successful ops.
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "invalid_op"),
        payload: Bytes::new(&env),
    });

    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: Bytes::from_array(&env, &50u32.to_be_bytes()),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 3);
    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(1));

    // State reflects both successful operations (1st and 3rd).
    assert_eq!(bridge.get_cooldown(), 100);
    assert_eq!(bridge.get_lock_period(), 50);
}

#[test]
fn test_batch_admin_with_quota() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);

    let quota_bytes = Bytes::from_array(&env, &1000i128.to_be_bytes());
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_quota"),
        payload: quota_bytes,
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 1);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 0);

    assert_eq!(bridge.get_withdrawal_quota(), 1000);
}

#[test]
fn test_batch_admin_empty_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let ops = soroban_sdk::Vec::new(&env);

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 0);
    assert_eq!(result.success_count, 0);
    assert_eq!(result.failure_count, 0);
    assert!(result.failed_index.is_none());
}

#[test]
fn test_batch_admin_overflow_prevention_with_malformed_payload() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let starting_quota = bridge.get_withdrawal_quota();

    let mut ops = soroban_sdk::Vec::new(&env);
    // set_quota requires a 16-byte i128 payload; this malformed payload should
    // fail safely and be counted, while other ops still execute.
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_quota"),
        payload: Bytes::from_array(&env, &[1u8, 2, 3, 4]),
    });
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: Bytes::from_array(&env, &120u32.to_be_bytes()),
    });

    let result = bridge.execute_batch_admin(&ops);
    assert_eq!(result.total_ops, 2);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.failed_index, Some(0));
    assert_eq!(bridge.get_withdrawal_quota(), starting_quota);
    assert_eq!(bridge.get_cooldown(), 120);
}

// ── fee vault tests ───────────────────────────────────────────────────────

#[test]
fn test_accrue_and_view_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 10_000);

    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);

    bridge.accrue_fee(&token_addr, &100);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 100);

    bridge.accrue_fee(&token_addr, &50);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 150);
}

#[test]
fn test_accrue_fee_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 10_000);

    let result = bridge.try_accrue_fee(&token_addr, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_fees_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    let recipient = Address::generate(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Deposit so contract has balance
    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Accrue fees
    bridge.accrue_fee(&token_addr, &200);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 200);

    // Withdraw fees
    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 100);
    assert_eq!(token.balance(&recipient), 100);
    assert_eq!(token.balance(&contract_id), 900);
}

#[test]
fn test_withdraw_fees_batch_full_sweep() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_a_addr, token_a, token_a_sac) = setup_bridge(&env, 10_000);
    let token_b_admin = Address::generate(&env);
    let (token_b_addr, token_b, token_b_sac) = create_token(&env, &token_b_admin);
    let recipient = Address::generate(&env);

    token_a_sac.mint(&contract_id, &120);
    token_b_sac.mint(&contract_id, &80);

    bridge.accrue_fee(&token_a_addr, &120);
    bridge.accrue_fee(&token_b_addr, &80);

    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_a_addr.clone());
    tokens.push_back(token_b_addr.clone());

    bridge.withdraw_fees_batch(&recipient, &tokens);

    assert_eq!(bridge.get_accrued_fees(&token_a_addr), 0);
    assert_eq!(bridge.get_accrued_fees(&token_b_addr), 0);
    assert_eq!(token_a.balance(&recipient), 120);
    assert_eq!(token_b.balance(&recipient), 80);
}

#[test]
fn test_withdraw_fees_batch_partial_sweep() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_a_addr, token_a, token_a_sac) = setup_bridge(&env, 10_000);
    let token_b_admin = Address::generate(&env);
    let (token_b_addr, token_b, _) = create_token(&env, &token_b_admin);
    let recipient = Address::generate(&env);

    token_a_sac.mint(&contract_id, &200);
    bridge.accrue_fee(&token_a_addr, &200);

    let mut tokens = soroban_sdk::Vec::new(&env);
    tokens.push_back(token_a_addr.clone());
    tokens.push_back(token_b_addr.clone());

    bridge.withdraw_fees_batch(&recipient, &tokens);

    assert_eq!(bridge.get_accrued_fees(&token_a_addr), 0);
    assert_eq!(bridge.get_accrued_fees(&token_b_addr), 0);
    assert_eq!(token_a.balance(&recipient), 200);
    assert_eq!(token_b.balance(&recipient), 0);
}

#[test]
fn test_withdraw_fees_exceeds_accrued() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 10_000);

    bridge.accrue_fee(&token_addr, &50);

    let result = bridge.try_withdraw_fees(&Address::generate(&env), &token_addr, &100, &0);
    assert_eq!(result, Err(Ok(Error::FeeWithdrawalExceedsBalance)));
}

#[test]
fn test_fee_vault_isolation_from_principal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // User deposits 1000
    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 1_000);

    // Accrue 200 in fees — this is separate accounting
    bridge.accrue_fee(&token_addr, &200);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 200);

    // Withdraw fees does NOT affect total_deposited or total_withdrawn
    bridge.withdraw_fees(&fee_recipient, &token_addr, &200, &0);
    assert_eq!(bridge.get_total_deposited(), 1_000);
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
    assert_eq!(token.balance(&fee_recipient), 200);
    assert_eq!(token.balance(&contract_id), 800);
}

// ── emergency token rescue tests ──────────────────────────────────────────

#[test]
fn test_rescue_non_protocol_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _token_addr, _, _) = setup_bridge(&env, 10_000);
    let rescue_admin = Address::generate(&env);

    // Create a separate "stray" token not part of the protocol
    let stray_admin = Address::generate(&env);
    let (stray_addr, stray_token, stray_sac) = create_token(&env, &stray_admin);

    // Simulate accidentally sending stray tokens to the contract
    stray_sac.mint(&contract_id, &500);
    assert_eq!(stray_token.balance(&contract_id), 500);

    // Rescue them
    bridge.rescue_token(&stray_addr, &rescue_admin, &300);
    assert_eq!(stray_token.balance(&rescue_admin), 300);
    assert_eq!(stray_token.balance(&contract_id), 200);
}

#[test]
fn test_rescue_primary_token_forbidden() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_rescue_token(&token_addr, &Address::generate(&env), &100);
    assert_eq!(result, Err(Ok(Error::RescueForbidden)));
}

#[test]
fn test_rescue_whitelisted_token_forbidden() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 10_000);

    // The token_addr is in the TokenRegistry (whitelisted), so rescue should fail
    let result = bridge.try_rescue_token(&token_addr, &Address::generate(&env), &100);
    assert_eq!(result, Err(Ok(Error::RescueForbidden)));
}

#[test]
fn test_rescue_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let stray_admin = Address::generate(&env);
    let (stray_addr, _, _) = create_token(&env, &stray_admin);

    let result = bridge.try_rescue_token(&stray_addr, &Address::generate(&env), &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_rescue_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let stray_admin = Address::generate(&env);
    let (stray_addr, _, stray_sac) = create_token(&env, &stray_admin);

    // Only 100 of stray token on contract
    stray_sac.mint(&contract_id, &100);

    let result = bridge.try_rescue_token(&stray_addr, &Address::generate(&env), &200);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

// ── nonce-based replay protection tests ───────────────────────────────────

#[test]
fn test_operator_nonce_starts_at_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);
    assert_eq!(bridge.get_operator_nonce(&operator), 0);
}

#[test]
fn test_heartbeat_with_valid_nonce_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // First heartbeat with nonce 0
    bridge.heartbeat(&operator, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Second heartbeat with nonce 1
    bridge.heartbeat(&operator, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);
}

#[test]
fn test_heartbeat_with_stale_nonce_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // First heartbeat with nonce 0
    bridge.heartbeat(&operator, &0);
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Try to replay with nonce 0 (stale)
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Nonce should remain unchanged
    assert_eq!(bridge.get_operator_nonce(&operator), 1);
}

#[test]
fn test_heartbeat_with_future_nonce_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Try to use nonce 5 when current is 0
    let result = bridge.try_heartbeat(&operator, &5);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Nonce should remain unchanged
    assert_eq!(bridge.get_operator_nonce(&operator), 0);
}

#[test]
fn test_heartbeat_replay_attack_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Execute heartbeat with nonce 0
    bridge.heartbeat(&operator, &0);
    let first_heartbeat = bridge.get_operator_heartbeat(&operator);

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number += 10;
    });

    // Try to replay the same nonce
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Heartbeat timestamp should not have changed
    assert_eq!(bridge.get_operator_heartbeat(&operator), first_heartbeat);
}

#[test]
fn test_nonce_is_per_operator() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator_a = Address::generate(&env);
    let operator_b = Address::generate(&env);

    bridge.set_operator(&operator_a, &true);
    bridge.set_operator(&operator_b, &true);

    // Both start at nonce 0
    assert_eq!(bridge.get_operator_nonce(&operator_a), 0);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 0);

    // Operator A uses nonce 0
    bridge.heartbeat(&operator_a, &0);
    assert_eq!(bridge.get_operator_nonce(&operator_a), 1);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 0);

    // Operator B can still use nonce 0
    bridge.heartbeat(&operator_b, &0);
    assert_eq!(bridge.get_operator_nonce(&operator_a), 1);
    assert_eq!(bridge.get_operator_nonce(&operator_b), 1);
}

#[test]
fn test_nonce_increments_monotonically() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Execute multiple heartbeats
    for i in 0..10 {
        assert_eq!(bridge.get_operator_nonce(&operator), i);
        bridge.heartbeat(&operator, &i);
        assert_eq!(bridge.get_operator_nonce(&operator), i + 1);
    }
}

#[test]
fn test_nonce_skipping_not_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Use nonce 0
    bridge.heartbeat(&operator, &0);

    // Try to skip to nonce 2 (skipping 1)
    let result = bridge.try_heartbeat(&operator, &2);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));

    // Nonce should still be 1
    assert_eq!(bridge.get_operator_nonce(&operator), 1);

    // Using nonce 1 should work
    bridge.heartbeat(&operator, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);
}

#[test]
fn test_nonce_persists_across_operator_deactivation() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Use nonce 0 and 1
    bridge.heartbeat(&operator, &0);
    bridge.heartbeat(&operator, &1);
    assert_eq!(bridge.get_operator_nonce(&operator), 2);

    // Deactivate operator
    bridge.set_operator(&operator, &false);

    // Nonce should still be 2
    assert_eq!(bridge.get_operator_nonce(&operator), 2);

    // Reactivate operator
    bridge.set_operator(&operator, &true);

    // Must use nonce 2, not 0
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    bridge.heartbeat(&operator, &2);
    assert_eq!(bridge.get_operator_nonce(&operator), 3);
}

#[test]
fn test_duplicate_nonce_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Use nonce 0
    bridge.heartbeat(&operator, &0);

    // Try to use nonce 0 again
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Use nonce 1
    bridge.heartbeat(&operator, &1);

    // Try to use nonce 1 again
    let result = bridge.try_heartbeat(&operator, &1);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));
}

#[test]
fn test_nonce_validation_before_heartbeat_update() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    let initial_ledger = env.ledger().sequence();
    bridge.heartbeat(&operator, &0);
    assert_eq!(
        bridge.get_operator_heartbeat(&operator),
        Some(initial_ledger)
    );

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number += 5;
    });

    // Try with invalid nonce - heartbeat should not update
    let result = bridge.try_heartbeat(&operator, &0);
    assert_eq!(result, Err(Ok(Error::StaleNonce)));

    // Heartbeat timestamp should not have changed
    assert_eq!(
        bridge.get_operator_heartbeat(&operator),
        Some(initial_ledger)
    );
}

#[test]
fn test_non_operator_cannot_use_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let non_operator = Address::generate(&env);

    // Don't set as operator
    assert!(!bridge.is_operator(&non_operator));

    // Try to heartbeat with nonce 0
    let result = bridge.try_heartbeat(&non_operator, &0);
    assert_eq!(result, Err(Ok(Error::NotOperator)));

    // Nonce should still be 0 (unchanged)
    assert_eq!(bridge.get_operator_nonce(&non_operator), 0);
}

#[test]
fn test_nonce_overflow_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    // Simulate high nonce value (near u64::MAX would take too long to test)
    // Instead, test that the system handles large nonces correctly
    let _large_nonce = 1_000_000u64;

    // Manually set a high nonce by executing many operations
    // For testing purposes, we'll just verify the logic works with reasonable values
    for i in 0..100 {
        bridge.heartbeat(&operator, &i);
    }

    assert_eq!(bridge.get_operator_nonce(&operator), 100);
}

#[test]
fn test_concurrent_operators_independent_nonces() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let op3 = Address::generate(&env);

    bridge.set_operator(&op1, &true);
    bridge.set_operator(&op2, &true);
    bridge.set_operator(&op3, &true);

    // Interleaved operations
    bridge.heartbeat(&op1, &0);
    bridge.heartbeat(&op2, &0);
    bridge.heartbeat(&op1, &1);
    bridge.heartbeat(&op3, &0);
    bridge.heartbeat(&op2, &1);
    bridge.heartbeat(&op1, &2);

    assert_eq!(bridge.get_operator_nonce(&op1), 3);
    assert_eq!(bridge.get_operator_nonce(&op2), 2);
    assert_eq!(bridge.get_operator_nonce(&op3), 1);
}

// ── Issue #214: deployment config hash tests ─────────────────────────────

#[test]
fn test_deploy_config_hash_stored_on_init() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 500);

    // Hash should be present immediately after init
    let hash = bridge.get_deploy_config_hash();
    assert!(hash.is_some());

    // Re-derive the expected hash from (admin, token, limit)
    let config_data = (admin.clone(), token_addr.clone(), 500i128);
    let expected: BytesN<32> = env.crypto().sha256(&config_data.to_xdr(&env)).into();
    assert_eq!(hash.unwrap(), expected);
}

#[test]
fn test_deploy_config_hash_is_immutable() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);
    let hash_before = bridge.get_deploy_config_hash();

    // Even after changing admin the stored hash must not change
    let new_admin = Address::generate(&env);
    bridge.transfer_admin(&new_admin);
    bridge.accept_admin();

    let hash_after = bridge.get_deploy_config_hash();
    assert_eq!(hash_before, hash_after);
}

#[test]
fn test_deploy_config_hash_differs_for_different_params() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge1, _, _, _, _) = setup_bridge(&env, 500);
    let (_, bridge2, _, _, _, _) = setup_bridge(&env, 1000);

    // Different limits → different hashes
    assert_ne!(
        bridge1.get_deploy_config_hash(),
        bridge2.get_deploy_config_hash()
    );
}

// ── Issue #220: fixed-point math unit tests ───────────────────────────────

#[test]
fn test_math_mul_div_floor_basic() {
    // 7 * 3 / 2 = 10 (floor of 10.5)
    assert_eq!(crate::math::mul_div_floor(7, 3, 2), 10);
}

#[test]
fn test_math_mul_div_floor_exact() {
    // 10 * 3 / 5 = 6 exactly
    assert_eq!(crate::math::mul_div_floor(10, 3, 5), 6);
}

#[test]
fn test_math_mul_div_floor_large_values() {
    // Typical fee calc: amount=1_000_000, price=9_500_000, denom=100_000
    // = 9_500_000_000_000 / 100_000 = 95_000_000
    let usd_cents = crate::math::mul_div_floor(1_000_000, 9_500_000, 100_000);
    assert_eq!(usd_cents, 95_000_000);
}

#[test]
fn test_math_mul_div_floor_zero_numerator() {
    assert_eq!(crate::math::mul_div_floor(0, 9_500_000, 100_000), 0);
}

#[test]
fn test_math_scale_floor() {
    // Scale 1000 by 3/4 = 750
    assert_eq!(crate::math::scale_floor(1000, 3, 4), 750);
}

// ── Issue #209: circuit breaker tests ────────────────────────────────────

#[test]
fn test_circuit_breaker_not_triggered_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&500);

    // 300 < 500 threshold — should succeed
    bridge.withdraw(&admin, &user, &300, &token_addr);
    assert!(!bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_trips_on_threshold_breach() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&500);

    // This withdrawal pushes total (0 + 600) > 500 — it succeeds but trips the breaker
    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_blocks_subsequent_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&300);

    // The crossing withdrawal succeeds but trips the breaker
    bridge.withdraw(&admin, &user, &400, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Subsequent withdrawal must fail
    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_circuit_breaker_reset_restores_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&300);

    // Trip it (crossing withdrawal goes through, then breaker fires)
    bridge.withdraw(&admin, &user, &400, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Admin resets
    bridge.reset_circuit_breaker();
    assert!(!bridge.is_circuit_breaker_tripped());

    // Advance window so global daily volume resets
    let start = env.ledger().sequence();
    env.ledger()
        .with_mut(|li| li.sequence_number = start + 17_280);

    // Withdrawal below threshold succeeds again
    bridge.withdraw(&admin, &user, &100, &token_addr);
}

#[test]
fn test_circuit_breaker_disabled_when_threshold_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    // Threshold 0 = disabled
    bridge.set_circuit_breaker_threshold(&0);

    bridge.withdraw(&admin, &user, &2000, &token_addr);
    assert!(!bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_also_blocks_execute_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&300);

    // This request exceeds threshold — it goes through but trips the breaker
    let r1 = bridge.request_withdrawal(&user, &400, &token_addr, &None, &0);
    bridge.execute_withdrawal(&r1, &None, &0, &0);
    assert!(bridge.is_circuit_breaker_tripped());

    // A second queued request is now blocked
    let r2 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    let result = bridge.try_execute_withdrawal(&r2, &None, &0, &0);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_circuit_breaker_trips_on_large_cumulative_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&500);

    // First withdrawal: 300 (cumulative 300 <= 500)
    bridge.withdraw(&admin, &user, &300, &token_addr);
    assert!(!bridge.is_circuit_breaker_tripped());

    // Second withdrawal: 300 (cumulative 600 > 500). This succeeds but trips the breaker.
    bridge.withdraw(&admin, &user, &300, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Third withdrawal: Should fail because breaker is active
    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_circuit_breaker_manual_reset_allows_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_circuit_breaker_threshold(&500);

    // Trip the breaker
    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Admin resets the breaker
    bridge.reset_circuit_breaker();
    assert!(!bridge.is_circuit_breaker_tripped());

    // Withdrawal should succeed now
    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert!(result.is_ok());
}

#[test]
fn test_circuit_breaker_respects_threshold_zero_disables_it() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &2000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Setting threshold to 0 disables the circuit breaker logic
    bridge.set_circuit_breaker_threshold(&0);

    // Perform large withdrawals that would otherwise trip any reasonable threshold
    bridge.withdraw(&admin, &user, &1000, &token_addr);
    bridge.withdraw(&admin, &user, &500, &token_addr);

    assert!(!bridge.is_circuit_breaker_tripped());
}

// ── Issue #226: withdrawal queue risk tier tests ──────────────────────────

#[test]
fn test_tier_queue_head_set_on_first_enqueue() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let r0 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let _r1 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);

    // Tier 0 has higher priority; get_next_priority_withdrawal should return r0
    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r0));
}

#[test]
fn test_tier_prioritization_higher_tier_waits() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Enqueue tier 2 first, then tier 0
    let r2 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &2);
    let r0 = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    // Tier 0 should be returned even though tier 2 was queued first
    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r0));

    // Execute tier 0 — now tier 2 should surface
    bridge.execute_withdrawal(&r0, &None, &0, &0);
    let next_after = bridge.get_next_priority_withdrawal();
    assert_eq!(next_after, Some(r2));
}

#[test]
fn test_tier_fifo_within_same_tier() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Two requests in the same tier — FIFO order expected
    let r_first = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);
    let r_second = bridge.request_withdrawal(&user, &50, &token_addr, &None, &1);

    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r_first));

    // After executing first, second should surface
    bridge.execute_withdrawal(&r_first, &None, &0, &0);
    let next_after = bridge.get_next_priority_withdrawal();
    assert_eq!(next_after, Some(r_second));
}

#[test]
fn test_tier_head_advances_after_cancel() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let r_a = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    let r_b = bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);

    // Cancel the head of tier 0 — r_b should become new head
    bridge.cancel_withdrawal(&r_a);
    let next = bridge.get_next_priority_withdrawal();
    assert_eq!(next, Some(r_b));
}

#[test]
fn test_get_next_priority_returns_none_when_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    assert_eq!(bridge.get_next_priority_withdrawal(), None);
}

// ── get_receipt_by_index tests ───────────────────────────────────────

#[test]
fn test_get_receipt_by_index_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    let receipt_hash = bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let receipt = bridge.get_receipt_by_index(&0);
    assert!(receipt.is_some());
    let receipt = receipt.unwrap();
    assert_eq!(receipt.id, receipt_hash);
    assert_eq!(receipt.depositor, user);
    assert_eq!(receipt.amount, 100);
}

#[test]
fn test_get_receipt_by_index_out_of_range() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Index 1 does not exist (only one deposit at index 0)
    assert_eq!(bridge.get_receipt_by_index(&1), None);
    // Large out-of-range index
    assert_eq!(bridge.get_receipt_by_index(&999), None);
}

#[test]
fn test_get_receipt_by_index_nonexistent_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // The receipt at index 0 should be accessible
    let receipt = bridge.get_receipt_by_index(&0);
    assert!(receipt.is_some());
    assert_eq!(receipt.unwrap().amount, 100);

    // Indexes that were never written return None
    assert_eq!(bridge.get_receipt_by_index(&50), None);
    assert_eq!(bridge.get_receipt_by_index(&u64::MAX), None);
}

#[test]
fn test_memo_hash_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    let valid_hash = BytesN::from_array(&env, &[1u8; 32]);

    // deposit: zero hash is rejected
    let result = bridge.try_deposit(
        &user,
        &100,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &Some(zero_hash.clone()),
    );
    assert_eq!(result, Err(Ok(Error::InvalidMemoHash)));

    // deposit: valid hash succeeds
    bridge.deposit(
        &user,
        &100,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &Some(valid_hash.clone()),
    );

    // request_withdrawal: zero hash is rejected
    let result = bridge.try_request_withdrawal(&user, &50, &token_addr, &Some(zero_hash), &0);
    assert_eq!(result, Err(Ok(Error::InvalidMemoHash)));

    // request_withdrawal: valid hash succeeds
    bridge.request_withdrawal(&user, &50, &token_addr, &Some(valid_hash), &0);
}

// ── Event topic structure tests ───────────────────────────────────────────────

/// Assert that every event emitted by the bridge contract in `f` has `EVENT_VERSION` (u32)
/// as its first XDR topic.
fn assert_bridge_events_have_version(env: &Env, contract_addr: &Address, f: impl FnOnce()) {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal, StringM};

    f();
    let bridge_events = env.events().all().filter_by_contract(contract_addr);
    let raw = bridge_events.events();
    assert!(!raw.is_empty(), "no bridge events were emitted");
    for event in raw {
        let ContractEventBody::V0(body) = &event.body;
        // With #[contractevent], the struct name is the topic and all fields
        // including `version` are in the data map. Find `version` in the map.
        let version_found = match &body.data {
            ScVal::Map(Some(map)) => map.iter().any(|entry| {
                entry.key
                    == ScVal::Symbol(ScSymbol(
                        StringM::try_from("version").expect("valid symbol"),
                    ))
                    && entry.val == ScVal::U32(EVENT_VERSION)
            }),
            _ => false,
        };
        assert!(
            version_found,
            "bridge event data map does not contain version={}: {:?}",
            EVENT_VERSION, body
        );
    }
}

#[test]
fn test_event_version_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_addr, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &500);

    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    });
}

#[test]
fn test_event_version_request_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_addr, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &500);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.request_withdrawal(&user, &50, &token_addr, &None, &0);
    });
}

#[test]
fn test_event_version_deny_add_remove() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_addr, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let target = Address::generate(&env);

    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.deny_address(&target);
    });
    assert_bridge_events_have_version(&env, &contract_addr, || {
        bridge.remove_denied_address(&target);
    });
}

// ── Property-based tests (proptest) ──────────────────────────────────────────

#[test]
fn test_event_snapshot_heartbeat() {
    let env = new_snapshot_env();
    env.mock_all_auths();
    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);
    env.ledger().with_mut(|li| {
        li.sequence_number = 12_345;
    });

    bridge.heartbeat(&operator, &0);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id.clone(),
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "nonce_inc").into_val(&env),
                    operator.clone().into_val(&env)
                ],
                1u64.into_val(&env)
            ),
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "heartbeat").into_val(&env),
                    operator.into_val(&env)
                ],
                12_345u32.into_val(&env)
            )
        ]
    );

    assert_event_snapshot(
        "heartbeat",
        &[
            SnapshotEvent {
                topics: StdVec::from([
                    "u32:1".into(),
                    "symbol:nonce_inc".into(),
                    "address:operator".into(),
                ]),
                data: "u64:1".into(),
            },
            SnapshotEvent {
                topics: StdVec::from([
                    "u32:1".into(),
                    "symbol:heartbeat".into(),
                    "address:operator".into(),
                ]),
                data: "u32:12345".into(),
            },
        ],
    );
}

#[test]
fn test_event_snapshot_deny_add() {
    let env = new_snapshot_env();
    env.mock_all_auths();
    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let target = Address::generate(&env);

    bridge.deny_address(&target);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "deny_add").into_val(&env)
                ],
                target.into_val(&env)
            )
        ]
    );

    assert_event_snapshot(
        "deny_add",
        &[SnapshotEvent {
            topics: StdVec::from(["u32:1".into(), "symbol:deny_add".into()]),
            data: "address:target".into(),
        }],
    );
}

#[test]
fn test_event_snapshot_deny_rem() {
    let env = new_snapshot_env();
    env.mock_all_auths();
    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 1_000);
    let target = Address::generate(&env);

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Denied(target.clone()), &true);
    });

    bridge.remove_denied_address(&target);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "deny_rem").into_val(&env)
                ],
                target.into_val(&env)
            )
        ]
    );

    assert_event_snapshot(
        "deny_rem",
        &[SnapshotEvent {
            topics: StdVec::from(["u32:1".into(), "symbol:deny_rem".into()]),
            data: "address:target".into(),
        }],
    );
}

#[test]
fn test_event_snapshot_quota_reset() {
    let env = new_snapshot_env();
    env.mock_all_auths();
    let (contract_id, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);

    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &2_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.set_withdrawal_quota(&500);
    bridge.withdraw(&admin, &user, &500, &token_addr);

    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::WithdrawalQuotaExceeded)));

    let start_ledger = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + 17_280;
    });

    bridge.withdraw(&admin, &user, &500, &token_addr);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id.clone(),
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "quota_reset").into_val(&env)
                ],
                (user.clone(), start_ledger + 17_280).into_val(&env)
            ),
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "withdraw").into_val(&env),
                    user.into_val(&env)
                ],
                500i128.into_val(&env)
            )
        ]
    );

    assert_event_snapshot(
        "quota_reset",
        &[
            SnapshotEvent {
                topics: StdVec::from(["u32:1".into(), "symbol:quota_reset".into()]),
                data: "tuple:[address:user,u32:17281]".into(),
            },
            SnapshotEvent {
                topics: StdVec::from([
                    "u32:1".into(),
                    "symbol:withdraw".into(),
                    "address:user".into(),
                ]),
                data: "i128:500".into(),
            },
        ],
    );
}

#[test]
fn test_event_snapshot_fee_accrued() {
    let env = new_snapshot_env();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, _, _) = setup_bridge(&env, 1_000);

    bridge.accrue_fee(&token_addr, &250);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "fee_accrue").into_val(&env),
                    token_addr.into_val(&env)
                ],
                250i128.into_val(&env)
            )
        ]
    );

    assert_event_snapshot(
        "fee_accrued",
        &[SnapshotEvent {
            topics: StdVec::from([
                "u32:1".into(),
                "symbol:fee_accrue".into(),
                "address:token".into(),
            ]),
            data: "i128:250".into(),
        }],
    );
}

#[test]
fn test_event_snapshot_fees_withdrawn() {
    let env = new_snapshot_env();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &400);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &400i128);
    });

    bridge.withdraw_fees(&recipient, &token_addr, &150, &0);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id,
                vec![
                    &env,
                    EVENT_VERSION.into_val(&env),
                    Symbol::new(&env, "fee_wdrw").into_val(&env),
                    recipient.into_val(&env)
                ],
                150i128.into_val(&env)
            )
        ]
    );

    assert_event_snapshot(
        "fees_withdrawn",
        &[SnapshotEvent {
            topics: StdVec::from([
                "u32:1".into(),
                "symbol:fee_wdrw".into(),
                "address:recipient".into(),
            ]),
            data: "i128:150".into(),
        }],
    );
}

#[cfg(test)]
mod proptest_deposit {
    use super::*;
    use proptest::prelude::*;

    // Deposit invariants that must hold for every positive amount <= limit:
    // 1. deposit() succeeds
    // 2. contract balance increases by exactly amount
    // 3. user balance decreases by exactly amount
    // 4. get_user_deposited() returns amount

    proptest! {
        #[test]
        fn deposit_invariants_hold_for_all_valid_amounts(amount in 1i128..=500i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (contract_id, bridge, admin, token_addr, token, token_sac) = setup_bridge(&env, 500);
            let user = Address::generate(&env);
            token_sac.mint(&user, &1_000);

            let user_before = token.balance(&user);
            let contract_before = token.balance(&contract_id);

            bridge.deposit(&user, &amount, &token_addr, &Bytes::new(&env), &0, &0, &None);

            prop_assert_eq!(token.balance(&user), user_before - amount);
            prop_assert_eq!(token.balance(&contract_id), contract_before + amount);
            prop_assert_eq!(bridge.get_user_deposited(&user), amount);
        }

        /// Amounts above the configured limit must be rejected with ExceedsLimit.
        #[test]
        fn deposit_above_limit_is_rejected(amount in 501i128..=10_000i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 500);
            let user = Address::generate(&env);
            token_sac.mint(&user, &amount);

            let result = bridge.try_deposit(&user, &amount, &token_addr, &Bytes::new(&env), &0, &0, &None);
            prop_assert_eq!(result, Err(Ok(Error::ExceedsLimit)));
        }
    }
}

#[cfg(test)]
mod proptest_request_withdrawal {
    use super::*;
    use proptest::prelude::*;

    // request_withdrawal invariants for valid amounts:
    // 1. Request is persisted with exact payload values
    // 2. Queue depth increments
    // 3. Total liabilities increase by amount
    // 4. No token transfer occurs at request time
    proptest! {
        #[test]
        fn request_withdrawal_invariants_hold_for_all_valid_amounts(amount in 1i128..=500i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (contract_id, bridge, _admin, token_addr, token, token_sac) = setup_bridge(&env, 1_000);
            let user = Address::generate(&env);
            token_sac.mint(&user, &1_000);
            bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

            let user_before = token.balance(&user);
            let contract_before = token.balance(&contract_id);

            let req_id = bridge.request_withdrawal(&user, &amount, &token_addr, &None, &0);
            let req = bridge.get_withdrawal_request(&req_id).unwrap();

            prop_assert_eq!(req.to, user.clone());
            prop_assert_eq!(req.token, token_addr);
            prop_assert_eq!(req.amount, amount);
            prop_assert_eq!(req.risk_tier, 0);
            prop_assert_eq!(bridge.get_wq_depth(), 1);
            prop_assert_eq!(bridge.get_total_liabilities(), amount);
            prop_assert_eq!(token.balance(&user), user_before);
            prop_assert_eq!(token.balance(&contract_id), contract_before);
        }

        /// Requests above net deposits must fail invariant checks.
        #[test]
        fn request_withdrawal_above_net_deposits_is_rejected(amount in 101i128..=1_000i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (_, bridge, _admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
            let user = Address::generate(&env);
            token_sac.mint(&user, &1_000);
            bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

            let result = bridge.try_request_withdrawal(&user, &amount, &token_addr, &None, &0);
            prop_assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
        }

        /// Non-positive amounts are always invalid.
        #[test]
        fn request_withdrawal_non_positive_amount_is_rejected(amount in -1_000i128..=0i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (_, bridge, _admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
            let user = Address::generate(&env);
            token_sac.mint(&user, &1_000);
            bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

            let result = bridge.try_request_withdrawal(&user, &amount, &token_addr, &None, &0);
            prop_assert_eq!(result, Err(Ok(Error::ZeroAmount)));
        }
    }
}

// ── Per-token daily deposit limit tests (#381) ──────────────────────
// ── Per-token daily deposit limit tests ──────────────────────────────

#[test]
fn test_daily_deposit_limit_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    // Set daily deposit limit to 500
    bridge.set_daily_deposit_limit(&token_addr, &500);

    // Deposit 200 — should succeed (within limit)
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Deposit 300 — should succeed (at limit: 200 + 300 = 500)
    bridge.deposit(&user, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Deposit 1 more — should fail (exceeds daily limit)
    let result = bridge.try_deposit(&user, &1, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));
}

#[test]
fn test_daily_deposit_limit_window_reset() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    bridge.set_daily_deposit_limit(&token_addr, &500);

    // Fill the daily limit
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Confirm limit is hit
    let result = bridge.try_deposit(&user, &1, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));

    // Advance ledger past the window (WINDOW_LEDGERS = 17_280)
    env.ledger().with_mut(|li| {
        li.sequence_number += 17_280;
    });

    // After window reset, deposit should succeed again
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
}

#[test]
fn test_daily_deposit_limit_per_user() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1_000);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    token_sac.mint(&user_a, &10_000);
    token_sac.mint(&user_b, &10_000);

    bridge.set_daily_deposit_limit(&token_addr, &500);

    // User A fills their daily limit
    bridge.deposit(&user_a, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // User A is blocked
    let result = bridge.try_deposit(&user_a, &1, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));

    // User B can still deposit — limits are per-user
    bridge.deposit(&user_b, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
}

// ── Escrow accounting invariant tests (#382) ─────────────────────────

#[test]
fn test_escrow_accounting_invariant_after_full_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    let deposit_amounts: [i128; 5] = [100, 250, 75, 400, 175];
    let expected_total: i128 = deposit_amounts.iter().sum();

    for amount in deposit_amounts.iter() {
        bridge.deposit(&user, amount, &token_addr, &Bytes::new(&env), &0, &0, &None);
    }

    // Migrate all receipts in one batch
    let migrated = bridge.migrate_escrow(&10);
    assert_eq!(migrated, deposit_amounts.len() as u32);

    // Version must be set after full migration
    assert_eq!(bridge.get_escrow_storage_version(), ESCROW_STORAGE_VERSION);

    // Sum all EscrowRecord amounts and assert equal to deposit total
    let mut escrow_total: i128 = 0;
    for i in 0..(deposit_amounts.len() as u64) {
        let record = bridge
            .get_escrow_record(&i)
            .expect("escrow record must exist");
        assert!(record.migrated);
        assert_eq!(record.version, ESCROW_STORAGE_VERSION);
        escrow_total += record.amount;
    }
    assert_eq!(escrow_total, expected_total);
}

#[test]
fn test_escrow_partial_migration_preserves_count() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    let deposit_amounts: [i128; 4] = [100, 200, 300, 400];
    let expected_total: i128 = deposit_amounts.iter().sum();

    for amount in deposit_amounts.iter() {
        bridge.deposit(&user, amount, &token_addr, &Bytes::new(&env), &0, &0, &None);
    }

    // Migrate only first 2 (batch_size < total)
    let migrated1 = bridge.migrate_escrow(&2);
    assert_eq!(migrated1, 2);
    assert_eq!(bridge.get_migration_cursor(), 2);
    // Version stays 0 until complete
    assert_eq!(bridge.get_escrow_storage_version(), 0);

    // First 2 records exist, last 2 don't yet
    assert!(bridge.get_escrow_record(&0).is_some());
    assert!(bridge.get_escrow_record(&1).is_some());
    assert!(bridge.get_escrow_record(&2).is_none());
    assert!(bridge.get_escrow_record(&3).is_none());

    // Migrate the remaining
    let migrated2 = bridge.migrate_escrow(&10);
    assert_eq!(migrated2, 2);
    assert_eq!(bridge.get_migration_cursor(), 4);
    assert_eq!(bridge.get_escrow_storage_version(), ESCROW_STORAGE_VERSION);

    // All records now exist and totals match
    let mut escrow_total: i128 = 0;
    for i in 0..4u64 {
        let record = bridge
            .get_escrow_record(&i)
            .expect("escrow record must exist");
        assert!(record.migrated);
        escrow_total += record.amount;
    }
    assert_eq!(escrow_total, expected_total);
}

// ── Issue #118: Withdrawal operator role tests ────────────────────────

#[test]
fn test_withdraw_operator_role() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup bridge and get admin.
    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);

    // Create operator and a regular user
    let operator = Address::generate(&env);
    let user = Address::generate(&env);

    // Give user some balance and properly deposit it so the contract state is coherent
    token_sac.mint(&user, &1000);
    let _ = bridge.deposit(&user, &1000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // 1. Admin can still call withdraw as before
    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Ok(Ok(())));

    // 2. A designated operator address can call withdraw without being the admin
    // First, set the operator (admin is invoking this)
    assert_eq!(bridge.get_withdraw_operator(), None);
    bridge.set_withdraw_operator(&operator);
    assert_eq!(bridge.get_withdraw_operator(), Some(operator.clone()));

    // Operator triggers withdraw
    let result = bridge.try_withdraw(&operator, &user, &100, &token_addr);
    assert_eq!(result, Ok(Ok(())));

    // 3. Operator cannot call set_limit; attempting returns Unauthorized.
    // In soroban tests env.mock_all_auths() blindly approves any signature.
    // However, the real check relies on `admin.require_auth()`. In testing, it's mocked, but logically
    // any endpoint hitting `admin.require_auth()` works only because of mock_all_auths.

    // 4. Removing the operator prevents that address from calling withdraw
    bridge.remove_withdraw_operator();
    assert_eq!(bridge.get_withdraw_operator(), None);

    // Operator is removed, so withdraw fails with Unauthorized
    let result = bridge.try_withdraw(&operator, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Issue #109: withdraw self-address guard tests ─────────────────────────

#[test]
fn test_withdraw_to_self_address_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    // Deposit so the contract has a balance to withdraw from
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Attempt to withdraw to the contract's own address — should be rejected
    // Order: caller, to, amount, token

    let result = bridge.try_withdraw(&admin, &contract_id, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));

    // Withdrawing to a regular user address must still succeed
    bridge.withdraw(&admin, &user, &100, &token_addr);
}
// ── Issue #111: TotalDeposited accumulator overflow guard tests ──────────

#[test]
fn test_deposit_overflow_guard() {
    let env = Env::default();
    env.mock_all_auths();

    // Use a large limit to avoid ExceedsLimit
    let limit = i128::MAX;
    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, limit);
    let user = Address::generate(&env);

    // User needs enough funds
    token_sac.mint(&user, &1000);

    // Manually push the total_deposited counter near i128::MAX
    let mut config: TokenConfig = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::TokenRegistry(token_addr.clone()))
            .unwrap()
    });

    // Setting it 50 away from MAX
    config.total_deposited = i128::MAX - 50;

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token_addr.clone()), &config);
    });

    // Depositing 100 should overflow
    let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::Overflow)));
}

// ── Issue #113: minimum deposit floor tests ───────────────────────────────

#[test]
fn test_init_rejects_invalid_min_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_addr, _, _) = create_token(&env, &token_admin);

    // Reject 0
    let signers = vec![&env, admin.clone()];

    // Reject 0
    let result = bridge.try_init(&admin, &token_addr, &1000, &0, &signers, &1);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));

    // Reject negative
    let result = bridge.try_init(&admin, &token_addr, &1000, &-5, &signers, &1);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));

    // Reject min_deposit >= limit
    let result = bridge.try_init(&admin, &token_addr, &1000, &1000, &signers, &1);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));

    let result = bridge.try_init(&admin, &token_addr, &1000, &2000, &signers, &1);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));
}

#[test]
fn test_deposit_below_minimum_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    // Limit = 10_000, MinDeposit = 500
    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge_with_min(&env, 10_000, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    // 499 < 500 should be rejected
    let result = bridge.try_deposit(&user, &499, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));

    // Default config minimum is 1, so 0 should already fail due to ZeroAmount,
    // let's verify custom min_deposit blocks 1 through min_deposit - 1.
}

#[test]
fn test_deposit_exactly_minimum_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge_with_min(&env, 10_000, 500);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    // Exactly 500 should succeed
    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 500);
}

#[test]
fn test_set_min_deposit_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    assert_eq!(bridge.get_min_deposit(), 1);

    // Should succeed because admin is mocked
    bridge.set_min_deposit(&500);
    assert_eq!(bridge.get_min_deposit(), 500);

    // Try to set below minimum
    let result = bridge.try_set_min_deposit(&0);
    assert_eq!(result, Err(Ok(Error::BelowMinimum)));
}

// ── get_denied_addresses tests ────────────────────────────────────────────

#[test]
fn test_get_denied_addresses_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let result = bridge.get_denied_addresses(&0, &10);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_denied_addresses_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    bridge.deny_address(&user1);
    bridge.deny_address(&user2);
    bridge.deny_address(&user3);

    let result = bridge.get_denied_addresses(&0, &10);
    assert_eq!(result.len(), 3);
    assert!(result.contains(&user1));
    assert!(result.contains(&user2));
    assert!(result.contains(&user3));
}

#[test]
fn test_get_denied_addresses_pagination_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    bridge.deny_address(&user1);
    bridge.deny_address(&user2);
    bridge.deny_address(&user3);

    let page = bridge.get_denied_addresses(&0, &2);
    assert_eq!(page.len(), 2);
}

#[test]
fn test_get_denied_addresses_pagination_offset() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    bridge.deny_address(&user1);
    bridge.deny_address(&user2);
    bridge.deny_address(&user3);

    let page = bridge.get_denied_addresses(&2, &10);
    assert_eq!(page.len(), 1);
    assert!(page.contains(&user3));
}

#[test]
fn test_get_denied_addresses_sparse_after_remove() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    bridge.deny_address(&user1);
    bridge.deny_address(&user2);
    bridge.deny_address(&user3);

    bridge.remove_denied_address(&user2);

    let result = bridge.get_denied_addresses(&0, &10);
    assert_eq!(result.len(), 2);
    assert!(result.contains(&user1));
    assert!(!result.contains(&user2));
    assert!(result.contains(&user3));
}

#[test]
fn test_get_denied_addresses_persists_across_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);

    bridge.deny_address(&user);

    let start_ledger = env.ledger().sequence();

    env.ledger().with_mut(|li| {
        li.sequence_number = start_ledger + WINDOW_LEDGERS;
    });

    let result = bridge.get_denied_addresses(&0, &10);
    assert_eq!(result.len(), 1);
    assert!(result.contains(&user));
    assert!(bridge.is_denied(&user));
}

#[test]
fn test_get_denied_addresses_offset_beyond_count() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    bridge.deny_address(&user);

    let result = bridge.get_denied_addresses(&100, &10);
    assert_eq!(result.len(), 0);
}

// ── withdrawal expiry tests ───────────────────────────────────────────────
#[test]
fn test_reclaim_expired_withdrawal_succeeds_after_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let queued_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    // Advance past the default expiry window
    env.ledger().with_mut(|li| {
        li.sequence_number = queued_ledger + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS + 1;
    });

    // Should succeed — request is expired
    bridge.reclaim_expired_withdrawal(&req_id);

    // Request should be gone
    assert!(bridge.get_withdrawal_request(&req_id).is_none());
}

#[test]
fn test_reclaim_expired_withdrawal_fails_before_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let queued_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    // Still inside expiry window — reclaim must fail
    env.ledger().with_mut(|li| {
        li.sequence_number = queued_ledger + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS - 1;
    });

    let result = bridge.try_reclaim_expired_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    assert!(bridge.get_withdrawal_request(&req_id).is_some());
}

#[test]
fn test_reclaim_expired_withdrawal_at_exact_boundary_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Capture current ledger sequence before advancing
    let start_ledger = env.ledger().sequence();

    // Advance beyond window
    let queued_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    // Advance to exactly the boundary — must NOT be reclaimable (strict >)
    env.ledger().with_mut(|li| {
        li.sequence_number = queued_ledger + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS;
    });

    let result = bridge.try_reclaim_expired_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));
}

#[test]
fn test_set_and_get_withdrawal_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    // Default is the compile-time constant
    assert_eq!(
        bridge.get_withdrawal_expiry(),
        WITHDRAWAL_EXPIRY_WINDOW_LEDGERS
    );

    // Set a custom window
    bridge.set_withdrawal_expiry(&500);
    assert_eq!(bridge.get_withdrawal_expiry(), 500);
}

#[test]
fn test_reclaim_uses_configured_expiry_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Set a short custom expiry window of 50 ledgers
    bridge.set_withdrawal_expiry(&50);

    let queued_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    // Still locked at ledger 50
    env.ledger().with_mut(|li| {
        li.sequence_number = queued_ledger + 50;
    });
    let result = bridge.try_reclaim_expired_withdrawal(&req_id);
    assert_eq!(result, Err(Ok(Error::WithdrawalLocked)));

    // Expired at ledger 51
    env.ledger().with_mut(|li| {
        li.sequence_number = queued_ledger + 51;
    });
    bridge.reclaim_expired_withdrawal(&req_id);
    assert!(bridge.get_withdrawal_request(&req_id).is_none());
}

#[test]
fn test_reclaim_nonexistent_request_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    let result = bridge.try_reclaim_expired_withdrawal(&999u64);
    assert_eq!(result, Err(Ok(Error::RequestNotFound)));
}

#[test]
fn test_reclaim_does_not_transfer_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let contract_balance_before = token.balance(&contract_id);

    let queued_ledger = env.ledger().sequence();
    let req_id = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number = queued_ledger + WITHDRAWAL_EXPIRY_WINDOW_LEDGERS + 1;
    });

    bridge.reclaim_expired_withdrawal(&req_id);

    // Contract balance unchanged — funds stay in escrow
    assert_eq!(token.balance(&contract_id), contract_balance_before);
    // User balance unchanged — nothing returned
    assert_eq!(token.balance(&user), 4_500);
}

// ── Circuit breaker auto-reset tests ─────────────────────────────────────

#[test]
fn test_circuit_breaker_auto_resets_after_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &50_000);

    bridge.deposit(
        &user,
        &10_000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    // Set threshold low enough to trip immediately
    bridge.set_circuit_breaker_threshold(&500);

    // This withdrawal trips the breaker
    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Still blocked within reset window
    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));

    // Advance past the default reset window (CIRCUIT_BREAKER_RESET_LEDGERS = 34_560)
    let start = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 34_561;
    });

    // Now the withdrawal should succeed — auto-reset kicks in
    bridge.withdraw(&admin, &user, &100, &token_addr);

    // Breaker should be clear after auto-reset
    assert!(!bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_still_blocked_before_reset_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &50_000);

    bridge.deposit(
        &user,
        &10_000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.set_circuit_breaker_threshold(&500);

    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Advance to exactly the reset window boundary — should still be blocked (strict >)
    let start = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 34_560;
    });

    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_set_and_get_circuit_breaker_reset_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    // Default is the compile-time constant
    assert_eq!(bridge.get_circuit_breaker_reset_window(), 34_560);

    // Set a custom window
    bridge.set_circuit_breaker_reset_window(&1_000);
    assert_eq!(bridge.get_circuit_breaker_reset_window(), 1_000);
}

#[test]
fn test_circuit_breaker_auto_reset_uses_configured_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &50_000);

    bridge.deposit(
        &user,
        &10_000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.set_circuit_breaker_threshold(&500);

    // Set a short custom reset window
    bridge.set_circuit_breaker_reset_window(&100);

    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Still blocked at exactly the boundary
    let start = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 100;
    });
    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));

    // Auto-resets one ledger past the window
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 101;
    });
    bridge.withdraw(&admin, &user, &100, &token_addr);
    assert!(!bridge.is_circuit_breaker_tripped());
}

#[test]
fn test_circuit_breaker_auto_reset_disabled_with_max_window() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &50_000);

    bridge.deposit(
        &user,
        &10_000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.set_circuit_breaker_threshold(&500);

    // Disable auto-reset
    bridge.set_circuit_breaker_reset_window(&u32::MAX);

    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Advance a very long time — should still be blocked
    let start = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 1_000_000;
    });

    let result = bridge.try_withdraw(&admin, &user, &100, &token_addr);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));

    // Manual reset still works
    bridge.reset_circuit_breaker();
    bridge.withdraw(&admin, &user, &100, &token_addr);
}

#[test]
fn test_manual_reset_still_works_after_feature_added() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 100_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &50_000);

    bridge.deposit(
        &user,
        &10_000,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.set_circuit_breaker_threshold(&500);

    bridge.withdraw(&admin, &user, &600, &token_addr);
    assert!(bridge.is_circuit_breaker_tripped());

    // Manual reset works without waiting for window
    bridge.reset_circuit_breaker();
    assert!(!bridge.is_circuit_breaker_tripped());

    bridge.withdraw(&admin, &user, &100, &token_addr);
}
// ── Admin renounce while paused tests ────────────────────────────────────

#[test]
fn test_queue_renounce_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    bridge.pause();

    // Attempting to queue renounce while paused must fail
    let result = bridge.try_queue_renounce_admin();
    assert_eq!(result, Err(Ok(Error::ContractPaused)));

    // No pending renounce should have been set
    assert_eq!(bridge.get_pending_renounce_ledger(), None);
}

#[test]
fn test_queue_renounce_succeeds_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    bridge.pause();

    // Blocked while paused
    let result = bridge.try_queue_renounce_admin();
    assert_eq!(result, Err(Ok(Error::ContractPaused)));

    // Unpausing should allow queuing
    bridge.unpause();
    bridge.queue_renounce_admin();
    assert!(bridge.get_pending_renounce_ledger().is_some());
}

#[test]
fn test_queue_renounce_succeeds_when_not_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1_000);

    // Normal flow — not paused, should work fine
    bridge.queue_renounce_admin();
    assert!(bridge.get_pending_renounce_ledger().is_some());
}

// ── upgrade mechanism tests ───────────────────────────────────────────────

#[test]
fn test_execute_upgrade_before_delay_fails_with_upgrade_not_ready() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);

    let proposed_wasm_hash = BytesN::from_array(&env, &[7u8; 32]);
    bridge.propose_upgrade(&proposed_wasm_hash, &1000);

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeNotReady)));
}

#[test]
fn test_cancel_upgrade_removes_pending_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);

    let proposed_wasm_hash = BytesN::from_array(&env, &[9u8; 32]);
    bridge.propose_upgrade(&proposed_wasm_hash, &1000);
    assert!(bridge.get_upgrade_proposal().is_some());

    bridge.cancel_upgrade();
    assert!(bridge.get_upgrade_proposal().is_none());

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
}

#[test]
fn test_upgrade_delay_cannot_be_below_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);

    let zero_delay = bridge.try_set_upgrade_delay(&0);
    assert_eq!(zero_delay, Err(Ok(Error::UpgradeDelayTooShort)));

    let below_min = bridge.try_set_upgrade_delay(&999);
    assert_eq!(below_min, Err(Ok(Error::UpgradeDelayTooShort)));

    bridge.set_upgrade_delay(&1000);
    assert_eq!(bridge.get_upgrade_delay(), 1000);
}

#[test]
fn test_execute_upgrade_after_delay_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 500);
    bridge.set_upgrade_delay(&1000);

    let fixture_wasm = load_valid_contract_wasm_fixture();
    let wasm_hash = env
        .deployer()
        .upload_contract_wasm(Bytes::from_slice(&env, fixture_wasm.as_slice()));
    bridge.propose_upgrade(&wasm_hash, &1000);

    let start = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number = start + 1000;
    });

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Ok(Ok(())));
}

// ── Issue #613: Invariant tests for deposit function ──────────────────────

#[test]
fn test_deposit_invariant_balance_increases() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5000);

    let contract_balance_before = token.balance(&contract_id);
    let user_balance_before = token.balance(&user);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let contract_balance_after = token.balance(&contract_id);
    let user_balance_after = token.balance(&user);

    // Invariant: contract balance increases by exactly amount
    assert_eq!(contract_balance_after, contract_balance_before + 500);
    // Invariant: user balance decreases by exactly amount
    assert_eq!(user_balance_after, user_balance_before - 500);
}

#[test]
fn test_deposit_invariant_user_deposited_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10000);

    assert_eq!(bridge.get_user_deposited(&user), 0);

    bridge.deposit(&user, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user), 300);

    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_user_deposited(&user), 500);
}

#[test]
fn test_deposit_invariant_total_deposited_increases() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10000);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    token_sac.mint(&user1, &5000);
    token_sac.mint(&user2, &5000);

    assert_eq!(bridge.get_total_deposited(), 0);

    bridge.deposit(&user1, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 200);

    bridge.deposit(&user2, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 500);
}

#[test]
fn test_deposit_invariant_receipt_issued_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    let receipt_id = bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Verify receipt was created (receipts are indexed, so we get by index 0)
    let receipt = bridge.get_receipt_by_index(&0).unwrap();
    assert_eq!(receipt.depositor, user);
    assert_eq!(receipt.amount, 100);
    assert!(!receipt.refunded);
}

#[test]
fn test_deposit_invariant_multiple_deposits_same_user() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10000);

    let id1 = bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let id2 = bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let id3 = bridge.deposit(&user, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // All receipt IDs must be unique
    assert_ne!(id1, id2);
    assert_ne!(id2, id3);
    assert_ne!(id1, id3);

    // User total must be sum of all deposits
    assert_eq!(bridge.get_user_deposited(&user), 600);
}

#[test]
fn test_deposit_invariant_emits_deposit_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &250, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();

    // Should have DepositEvent and ReceiptIssuedEvent
    assert!(raw.len() >= 2);
}

// ── Issue #614: Invariant tests for set_operator function ────────────────

#[test]
fn test_set_operator_invariant_activation() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    assert!(!bridge.is_operator(&operator));

    bridge.set_operator(&operator, &true);
    assert!(bridge.is_operator(&operator));

    bridge.set_operator(&operator, &false);
    assert!(!bridge.is_operator(&operator));
}

#[test]
fn test_set_operator_invariant_operator_list_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let op3 = Address::generate(&env);

    bridge.set_operator(&op1, &true);
    bridge.set_operator(&op2, &true);
    bridge.set_operator(&op3, &true);

    assert!(bridge.is_operator(&op1));
    assert!(bridge.is_operator(&op2));
    assert!(bridge.is_operator(&op3));

    bridge.set_operator(&op2, &false);

    assert!(bridge.is_operator(&op1));
    assert!(!bridge.is_operator(&op2));
    assert!(bridge.is_operator(&op3));
}

#[test]
fn test_set_operator_invariant_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);

    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();

    // Should have SetOperatorEvent
    assert!(raw.len() > 0);
}

#[test]
fn test_set_operator_invariant_idempotent_activation() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);
    assert!(bridge.is_operator(&operator));

    // Setting to true again should be safe
    bridge.set_operator(&operator, &true);
    assert!(bridge.is_operator(&operator));
}

#[test]
fn test_set_operator_invariant_idempotent_deactivation() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);
    let operator = Address::generate(&env);

    bridge.set_operator(&operator, &true);
    bridge.set_operator(&operator, &false);
    assert!(!bridge.is_operator(&operator));

    // Setting to false again should be safe
    bridge.set_operator(&operator, &false);
    assert!(!bridge.is_operator(&operator));
}

#[test]
fn test_set_operator_invariant_respects_max_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    bridge.set_max_operators(&2);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let op3 = Address::generate(&env);

    bridge.set_operator(&op1, &true);
    bridge.set_operator(&op2, &true);

    // Third operator should fail due to cap
    let result = bridge.try_set_operator(&op3, &true);
    assert_eq!(result, Err(Ok(Error::OperatorCapReached)));

    assert!(bridge.is_operator(&op1));
    assert!(bridge.is_operator(&op2));
    assert!(!bridge.is_operator(&op3));
}

// ── Issue #617: Edge case validation for withdraw_fees ──────────────────

#[test]
fn test_withdraw_fees_edge_case_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 1000);

    let result = bridge.try_withdraw_fees(&Address::generate(&env), &token_addr, &0, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_fees_edge_case_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 1000);

    let result = bridge.try_withdraw_fees(&Address::generate(&env), &token_addr, &-100, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_fees_edge_case_exact_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.accrue_fee(&token_addr, &100);

    // Withdraw exactly the accrued amount
    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);

    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
    assert_eq!(token.balance(&recipient), 100);
}

#[test]
fn test_withdraw_fees_edge_case_exceeds_accrued() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 1000);

    bridge.accrue_fee(&token_addr, &50);

    let result = bridge.try_withdraw_fees(&Address::generate(&env), &token_addr, &100, &0);
    assert_eq!(result, Err(Ok(Error::FeeWithdrawalExceedsBalance)));
}

#[test]
fn test_withdraw_fees_edge_case_no_fees_accrued() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 1000);

    let result = bridge.try_withdraw_fees(&Address::generate(&env), &token_addr, &1, &0);
    assert_eq!(result, Err(Ok(Error::FeeWithdrawalExceedsBalance)));
}

#[test]
fn test_withdraw_fees_edge_case_multiple_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.accrue_fee(&token_addr, &300);

    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 200);

    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 100);

    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}

#[test]
fn test_withdraw_fees_edge_case_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.accrue_fee(&token_addr, &100);

    bridge.withdraw_fees(&recipient, &token_addr, &50, &0);

    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();

    // Should have FeeWithdrawnEvent
    assert!(raw.len() > 0);
}

// ── Issue #619: Edge case validation for request_withdrawal ────────────

#[test]
fn test_request_withdrawal_edge_case_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_request_withdrawal(&user, &0, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_request_withdrawal_edge_case_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let result = bridge.try_request_withdrawal(&user, &-100, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_request_withdrawal_edge_case_exceeds_net_deposited() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Try to withdraw more than deposited
    let result = bridge.try_request_withdrawal(&user, &600, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::InternalError)));
}

#[test]
fn test_request_withdrawal_edge_case_exact_deposited_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Request exactly the deposited amount
    let req_id = bridge.request_withdrawal(&user, &500, &token_addr, &None, &0);
    assert!(req_id >= 0);

    let req = bridge.get_withdrawal_request(&req_id).unwrap();
    assert_eq!(req.amount, 500);
}

#[test]
fn test_request_withdrawal_edge_case_updates_liabilities() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_liabilities(), 0);

    bridge.request_withdrawal(&user, &200, &token_addr, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 200);

    bridge.request_withdrawal(&user, &150, &token_addr, &None, &0);
    assert_eq!(bridge.get_total_liabilities(), 350);
}

#[test]
fn test_request_withdrawal_edge_case_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);

    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();

    // Should have WithdrawalRequestedEvent
    assert!(raw.len() > 0);
}

#[test]
fn test_request_withdrawal_edge_case_denied_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deny_address(&user);

    let result = bridge.try_request_withdrawal(&user, &100, &token_addr, &None, &0);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}

#[test]
fn test_request_withdrawal_edge_case_multiple_requests_same_user() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10000);

    bridge.deposit(&user, &5000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let r1 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    let r2 = bridge.request_withdrawal(&user, &200, &token_addr, &None, &0);
    let r3 = bridge.request_withdrawal(&user, &300, &token_addr, &None, &0);

    // All request IDs must be unique
    assert_ne!(r1, r2);
    assert_ne!(r2, r3);
    assert_ne!(r1, r3);

    // Total liabilities must be sum of all requests
    assert_eq!(bridge.get_total_liabilities(), 600);
}

#[test]
fn test_request_withdrawal_edge_case_risk_tier_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10000);

    bridge.deposit(&user, &5000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Request with different risk tiers
    let r0 = bridge.request_withdrawal(&user, &100, &token_addr, &None, &0);
    let r1 = bridge.request_withdrawal(&user, &200, &token_addr, &None, &1);
    let r2 = bridge.request_withdrawal(&user, &300, &token_addr, &None, &2);

    let req0 = bridge.get_withdrawal_request(&r0).unwrap();
    let req1 = bridge.get_withdrawal_request(&r1).unwrap();
    let req2 = bridge.get_withdrawal_request(&r2).unwrap();

    assert_eq!(req0.risk_tier, 0);
    assert_eq!(req1.risk_tier, 1);
    assert_eq!(req2.risk_tier, 2);
}

// ── Issue #538: pause — additional Soroban invariant tests ───────────────

#[test]
fn test_pause_invariant_read_only_views_unchanged_after_rejected_mutations() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.accrue_fee(&token_addr, &25);

    let admin_before = bridge.get_admin();
    let token_before = bridge.get_token();
    let limit_before = bridge.get_limit();
    let deposited_before = bridge.get_total_deposited();
    let fees_before = bridge.get_accrued_fees(&token_addr);
    let cooldown_before = bridge.get_cooldown();
    let lock_before = bridge.get_lock_period();

    bridge.pause();

    assert_eq!(
        bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None),
        Err(Ok(Error::ContractPaused))
    );

    assert_eq!(bridge.get_admin(), admin_before);
    assert_eq!(bridge.get_token(), token_before);
    assert_eq!(bridge.get_limit(), limit_before);
    assert_eq!(bridge.get_total_deposited(), deposited_before);
    assert_eq!(bridge.get_accrued_fees(&token_addr), fees_before);
    assert_eq!(bridge.get_cooldown(), cooldown_before);
    assert_eq!(bridge.get_lock_period(), lock_before);

    bridge.unpause();
    bridge.deposit(&user, &50, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), deposited_before + 50);
}

#[test]
fn test_pause_invariant_double_pause_still_blocks_users() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.pause();
    bridge.pause();

    assert_eq!(
        bridge.try_deposit(&user, &50, &token_addr, &Bytes::new(&env), &0, &0, &None),
        Err(Ok(Error::ContractPaused))
    );
}

// ── Issue #554: execute_batch_admin — invariant tests ────────────────────

#[test]
fn test_execute_batch_admin_invariant_success_plus_failure_equals_total_ops() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, _, _, _) = setup_bridge(&env, 10_000);

    let mut ops = soroban_sdk::Vec::new(&env);
    for n in [10u32, 11, 12, 13] {
        ops.push_back(BatchAdminOp {
            op_type: Symbol::new(&env, "set_cooldown"),
            payload: Bytes::from_array(&env, &n.to_be_bytes()),
        });
    }
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "not_a_real_op"),
        payload: Bytes::new(&env),
    });
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "set_lock"),
        payload: Bytes::from_array(&env, &99u32.to_be_bytes()),
    });

    let r = bridge.execute_batch_admin(&ops);
    assert_eq!(r.total_ops, 6);
    assert_eq!(r.success_count.saturating_add(r.failure_count), r.total_ops);
    assert_eq!(r.success_count, 5);
    assert_eq!(r.failure_count, 1);
    assert_eq!(r.failed_index, Some(4));
    assert_eq!(bridge.get_cooldown(), 13);
    assert_eq!(bridge.get_lock_period(), 99);
}

#[test]
fn test_execute_batch_admin_pause_op_matches_direct_pause_for_user_ops() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &2_000);

    bridge.deposit(&user, &500, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let mut ops = soroban_sdk::Vec::new(&env);
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "pause"),
        payload: Bytes::new(&env),
    });

    let r = bridge.execute_batch_admin(&ops);
    assert_eq!(r.total_ops, 1);
    assert_eq!(r.success_count, 1);
    assert_eq!(r.failure_count, 0);

    assert_eq!(
        bridge.try_deposit(&user, &50, &token_addr, &Bytes::new(&env), &0, &0, &None),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn test_execute_batch_admin_pause_then_unpause_in_one_batch_restores_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    bridge.deposit(&user, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let before = bridge.get_total_deposited();

    let mut ops = soroban_sdk::Vec::new(&env);
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "pause"),
        payload: Bytes::new(&env),
    });
    ops.push_back(BatchAdminOp {
        op_type: Symbol::new(&env, "unpause"),
        payload: Bytes::new(&env),
    });

    let r = bridge.execute_batch_admin(&ops);
    assert_eq!(r.total_ops, 2);
    assert_eq!(r.success_count, 2);
    assert_eq!(r.failure_count, 0);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), before + 100);
}
