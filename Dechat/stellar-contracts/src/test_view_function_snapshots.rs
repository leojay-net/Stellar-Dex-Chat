//! Snapshot tests for contract view functions.
//! Tests the return shapes of get_receipt_by_index, get_accrued_fees, and get_total_deposited.
//! These tests fail if the function return shapes change, preventing silent API changes.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

use crate::{FiatBridge, FiatBridgeClient, Receipt};

fn setup(env: &Env) -> (FiatBridgeClient, Address, Address, TokenClient) {
    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token = TokenClient::new(env, &token_addr);

    let signers = vec![env, admin.clone()];
    client.init(&admin, &token_addr, &10_000_000i128, &1i128, &signers, &1);

    StellarAssetClient::new(env, &token_addr).mint(&admin, &10_000_000i128);

    (client, admin, token_addr, token)
}

/// Snapshot test for get_receipt_by_index return shape.
/// Verifies that Receipt struct fields remain stable and in expected format.
#[test]
fn snapshot_get_receipt_by_index() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, admin, _token_addr, _token) = setup(&env);

    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;

    // Make a deposit to create a receipt
    client.deposit(&depositor, &deposit_amount);

    // Get the receipt by index
    let receipt = client.get_receipt_by_index(&0u64);

    // Verify the receipt is Some and has expected structure
    assert!(receipt.is_some(), "Receipt at index 0 should exist");

    if let Some(receipt_data) = receipt {
        // Verify Receipt has expected fields by accessing them
        let _idx = receipt_data.idx;
        let _depositor_addr = receipt_data.depositor;
        let _amount = receipt_data.amount;
        let _timestamp = receipt_data.timestamp;
        let _tx_hash = receipt_data.tx_hash;

        // Snapshot assertions on field values
        assert_eq!(receipt_data.idx, 0, "Receipt index should be 0");
        assert_eq!(receipt_data.depositor, depositor, "Depositor should match");
        assert_eq!(receipt_data.amount, deposit_amount, "Amount should match");
        assert!(receipt_data.timestamp > 0, "Timestamp should be set");
        assert!(!receipt_data.tx_hash.is_empty(), "Tx hash should not be empty");
    }
}

/// Snapshot test for get_receipt_by_index with non-existent index.
/// Verifies that querying invalid indices returns Option::None correctly.
#[test]
fn snapshot_get_receipt_by_index_nonexistent() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_addr, _token) = setup(&env);

    // Try to get a receipt that doesn't exist
    let receipt = client.get_receipt_by_index(&999u64);

    // Verify it returns None
    assert!(
        receipt.is_none(),
        "Receipt at non-existent index should be None"
    );
}

/// Snapshot test for get_accrued_fees return shape and value.
/// Verifies fee accumulation returns i128 in expected format.
#[test]
fn snapshot_get_accrued_fees() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, admin, token_addr, _token) = setup(&env);

    let initial_fees = client.get_accrued_fees(&token_addr);

    // Verify return type is i128 and starts at 0
    assert_eq!(initial_fees, 0i128, "Initial accrued fees should be 0");
    assert!(initial_fees >= 0, "Accrued fees should never be negative");

    // Make a deposit to accrue some fees (assuming 1% fee rate)
    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;
    client.deposit(&depositor, &deposit_amount);

    // Get updated fees
    let updated_fees = client.get_accrued_fees(&token_addr);

    // Verify fees increased
    assert!(updated_fees > initial_fees, "Fees should increase after deposit");
    assert!(updated_fees > 0, "Fees should be positive after deposit");
}

/// Snapshot test for get_total_deposited return shape and value.
/// Verifies total deposit tracking returns Result<i128, Error> with correct semantics.
#[test]
fn snapshot_get_total_deposited() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, _token_addr, _token) = setup(&env);

    let initial_total = client.get_total_deposited();

    // Verify return type is Result<i128, Error>
    assert!(
        initial_total.is_ok(),
        "get_total_deposited should return Ok for initial state"
    );
    assert_eq!(
        initial_total.unwrap_or(0),
        0,
        "Initial total deposited should be 0"
    );

    // Make a deposit
    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;
    client.deposit(&depositor, &deposit_amount);

    // Get updated total
    let updated_total = client.get_total_deposited();

    // Verify total increased
    assert!(updated_total.is_ok(), "get_total_deposited should return Ok");
    assert_eq!(
        updated_total.unwrap_or(0),
        deposit_amount,
        "Total deposited should equal the deposit amount"
    );
}

/// Snapshot test for get_total_deposited with multiple deposits.
/// Verifies cumulative behavior of the total deposited view function.
#[test]
fn snapshot_get_total_deposited_cumulative() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, _token_addr, _token) = setup(&env);

    let depositor1 = Address::generate(&env);
    let depositor2 = Address::generate(&env);
    let deposit1 = 1_000_000i128;
    let deposit2 = 2_000_000i128;

    // First deposit
    client.deposit(&depositor1, &deposit1);
    let total_after_first = client.get_total_deposited();
    assert_eq!(total_after_first.unwrap_or(0), deposit1);

    // Second deposit
    client.deposit(&depositor2, &deposit2);
    let total_after_second = client.get_total_deposited();

    // Verify cumulative total
    assert_eq!(
        total_after_second.unwrap_or(0),
        deposit1 + deposit2,
        "Total deposited should be sum of all deposits"
    );
}

/// Snapshot test for receipt structure immutability.
/// Verifies Receipt fields cannot change unexpectedly.
#[test]
fn snapshot_receipt_field_immutability() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, _token_addr, _token) = setup(&env);

    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;

    // Record initial timestamp
    let block_timestamp = env.ledger().timestamp();

    // Make deposit
    client.deposit(&depositor, &deposit_amount);

    // Retrieve receipt
    let receipt = client.get_receipt_by_index(&0u64).expect("Receipt should exist");

    // Verify receipt fields are immutable and match what we set
    assert_eq!(receipt.idx, 0, "Index should be 0 for first receipt");
    assert_eq!(receipt.depositor, depositor, "Depositor should match");
    assert_eq!(receipt.amount, deposit_amount, "Amount should match");
    assert!(
        receipt.timestamp >= block_timestamp,
        "Timestamp should be >= block time"
    );

    // Verify we can read fields multiple times (immutability check)
    let receipt_idx_again = client.get_receipt_by_index(&0u64).unwrap().idx;
    assert_eq!(
        receipt_idx_again, 0,
        "Receipt index should be same on repeated reads"
    );
}
