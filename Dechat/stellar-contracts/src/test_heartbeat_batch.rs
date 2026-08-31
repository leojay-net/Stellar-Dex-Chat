//! Integration and unit tests for batch heartbeat operations.

#![cfg(test)]

use crate::{
    BatchHeartbeatResult, Error, FiatBridge, FiatBridgeClient, HeartbeatBatchEvent,
    HeartbeatBatchFailEvent, HeartbeatEvent, HeartbeatItem, EVENT_VERSION,
};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token, vec, Address, Bytes, Env, Vec,
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

fn setup_test_bridge<'a>(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'a>,
    Address,
    Address,
    token::Client<'a>,
    token::StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);
    let signers = vec![env, admin.clone()];

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);
    (
        contract_id,
        client,
        admin,
        token_address,
        token_client,
        token_admin,
    )
}

#[test]
fn test_batch_heartbeat_success_multiple_operators() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let op3 = Address::generate(&env);

    bridge.set_operator(&op1, &true, &0);
    bridge.set_operator(&op2, &true, &0);
    bridge.set_operator(&op3, &true, &0);

    assert_eq!(bridge.get_operator_nonce(&op1), 1);
    assert_eq!(bridge.get_operator_nonce(&op2), 1);
    assert_eq!(bridge.get_operator_nonce(&op3), 1);

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number += 50;
    });
    let current_ledger = env.ledger().sequence();

    let mut items = Vec::new(&env);
    items.push_back(HeartbeatItem {
        operator: op1.clone(),
        nonce: 1,
    });
    items.push_back(HeartbeatItem {
        operator: op2.clone(),
        nonce: 1,
    });
    items.push_back(HeartbeatItem {
        operator: op3.clone(),
        nonce: 1,
    });

    let result = bridge.heartbeat_batch(&items);

    assert_eq!(
        result,
        BatchHeartbeatResult {
            total_items: 3,
            success_count: 3,
            failure_count: 0,
            failed_index: None,
        }
    );

    // All heartbeat timestamps and nonces updated
    assert_eq!(bridge.get_operator_heartbeat(&op1), Some(current_ledger));
    assert_eq!(bridge.get_operator_heartbeat(&op2), Some(current_ledger));
    assert_eq!(bridge.get_operator_heartbeat(&op3), Some(current_ledger));

    assert_eq!(bridge.get_operator_nonce(&op1), 2);
    assert_eq!(bridge.get_operator_nonce(&op2), 2);
    assert_eq!(bridge.get_operator_nonce(&op3), 2);
}

#[test]
fn test_batch_heartbeat_partial_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    let op3 = Address::generate(&env);

    bridge.set_operator(&op1, &true, &0);
    bridge.set_operator(&op2, &true, &0);
    bridge.set_operator(&op3, &true, &0);

    env.ledger().with_mut(|li| {
        li.sequence_number += 100;
    });
    let current_ledger = env.ledger().sequence();

    let mut items = Vec::new(&env);
    // op1: valid nonce (1)
    items.push_back(HeartbeatItem {
        operator: op1.clone(),
        nonce: 1,
    });
    // op2: invalid future nonce (99) -> should fail
    items.push_back(HeartbeatItem {
        operator: op2.clone(),
        nonce: 99,
    });
    // op3: valid nonce (1)
    items.push_back(HeartbeatItem {
        operator: op3.clone(),
        nonce: 1,
    });

    let result = bridge.heartbeat_batch(&items);

    assert_eq!(
        result,
        BatchHeartbeatResult {
            total_items: 3,
            success_count: 2,
            failure_count: 1,
            failed_index: Some(1),
        }
    );

    // op1 and op3 succeeded
    assert_eq!(bridge.get_operator_heartbeat(&op1), Some(current_ledger));
    assert_eq!(bridge.get_operator_nonce(&op1), 2);

    assert_eq!(bridge.get_operator_heartbeat(&op3), Some(current_ledger));
    assert_eq!(bridge.get_operator_nonce(&op3), 2);

    // op2 failed: heartbeat remains unset and nonce remains 1
    assert_eq!(bridge.get_operator_heartbeat(&op2), None);
    assert_eq!(bridge.get_operator_nonce(&op2), 1);
}

#[test]
fn test_batch_heartbeat_non_operator_rejected_in_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let op1 = Address::generate(&env);
    let non_op = Address::generate(&env);
    let op2 = Address::generate(&env);

    bridge.set_operator(&op1, &true, &0);
    bridge.set_operator(&op2, &true, &0);

    let mut items = Vec::new(&env);
    items.push_back(HeartbeatItem {
        operator: op1.clone(),
        nonce: 1,
    });
    items.push_back(HeartbeatItem {
        operator: non_op.clone(),
        nonce: 0,
    });
    items.push_back(HeartbeatItem {
        operator: op2.clone(),
        nonce: 1,
    });

    let result = bridge.heartbeat_batch(&items);

    assert_eq!(
        result,
        BatchHeartbeatResult {
            total_items: 3,
            success_count: 2,
            failure_count: 1,
            failed_index: Some(1),
        }
    );

    assert!(bridge.get_operator_heartbeat(&op1).is_some());
    assert!(bridge.get_operator_heartbeat(&op2).is_some());
    assert!(bridge.get_operator_heartbeat(&non_op).is_none());
}

#[test]
fn test_batch_heartbeat_blocked_by_circuit_breaker() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, admin, token_addr, _, token_sac) = setup_test_bridge(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // Trip circuit breaker by exceeding withdrawal threshold
    bridge.set_circuit_breaker_threshold(&500);
    token_sac.mint(&admin, &600);
    bridge.deposit(&admin, &600, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.withdraw(&admin, &admin, &600, &token_addr);

    let mut items = Vec::new(&env);
    items.push_back(HeartbeatItem {
        operator: op.clone(),
        nonce: 1,
    });

    let result = bridge.try_heartbeat_batch(&items);
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_batch_heartbeat_empty_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let items = Vec::new(&env);
    let result = bridge.heartbeat_batch(&items);

    assert_eq!(
        result,
        BatchHeartbeatResult {
            total_items: 0,
            success_count: 0,
            failure_count: 0,
            failed_index: None,
        }
    );
}

#[test]
fn test_batch_heartbeat_replay_attack_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    let mut items = Vec::new(&env);
    items.push_back(HeartbeatItem {
        operator: op.clone(),
        nonce: 1,
    });

    // First batch execution succeeds
    let result = bridge.heartbeat_batch(&items);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 0);

    // Replay the exact same batch with stale nonce 1
    let replay_result = bridge.heartbeat_batch(&items);
    assert_eq!(replay_result.success_count, 0);
    assert_eq!(replay_result.failure_count, 1);
    assert_eq!(replay_result.failed_index, Some(0));
}

#[test]
fn test_batch_heartbeat_sequential_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let op = Address::generate(&env);
    bridge.set_operator(&op, &true, &0);

    // Batch 1: nonce 1
    let mut batch1 = Vec::new(&env);
    batch1.push_back(HeartbeatItem {
        operator: op.clone(),
        nonce: 1,
    });
    let res1 = bridge.heartbeat_batch(&batch1);
    assert_eq!(res1.success_count, 1);
    assert_eq!(bridge.get_operator_nonce(&op), 2);

    // Batch 2: nonce 2
    let mut batch2 = Vec::new(&env);
    batch2.push_back(HeartbeatItem {
        operator: op.clone(),
        nonce: 2,
    });
    let res2 = bridge.heartbeat_batch(&batch2);
    assert_eq!(res2.success_count, 1);
    assert_eq!(bridge.get_operator_nonce(&op), 3);

    // Single heartbeat: nonce 3
    bridge.heartbeat(&op, &3);
    assert_eq!(bridge.get_operator_nonce(&op), 4);
}

#[test]
fn test_batch_heartbeat_emits_expected_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _admin, _token_addr, _token, _token_sac) = setup_test_bridge(&env);

    let op1 = Address::generate(&env);
    let op2 = Address::generate(&env);
    bridge.set_operator(&op1, &true, &0);
    bridge.set_operator(&op2, &true, &0);

    let current_ledger = env.ledger().sequence();

    let mut items = Vec::new(&env);
    items.push_back(HeartbeatItem {
        operator: op1.clone(),
        nonce: 1,
    });
    items.push_back(HeartbeatItem {
        operator: op2.clone(),
        nonce: 99, // Intentional failure
    });

    let _ = bridge.heartbeat_batch(&items);

    // Verify events were emitted
    let events = env.events().all().filter_by_contract(&contract_id);
    assert!(!events.events().is_empty());

    // Verify HeartbeatEvent, HeartbeatBatchFailEvent, and HeartbeatBatchEvent
    let expected_hb_event = HeartbeatEvent {
        version: EVENT_VERSION,
        operator: op1,
        ledger: current_ledger,
    };
    let expected_fail_event = HeartbeatBatchFailEvent {
        version: EVENT_VERSION,
        index: 1,
        total_items: 2,
    };
    let expected_batch_event = HeartbeatBatchEvent {
        version: EVENT_VERSION,
        total_items: 2,
        success_count: 1,
        failure_count: 1,
        ledger: current_ledger,
    };

    // Ensure structs instantiate correctly and have matching fields
    assert_eq!(expected_hb_event.version, EVENT_VERSION);
    assert_eq!(expected_fail_event.version, EVENT_VERSION);
    assert_eq!(expected_batch_event.version, EVENT_VERSION);
}
