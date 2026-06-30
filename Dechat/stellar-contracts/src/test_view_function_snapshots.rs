//! Snapshot tests for contract view functions.
//! Tests the return shapes of get_receipt_by_index, get_accrued_fees, and get_total_deposited.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, Env,
};

use crate::{FiatBridge, FiatBridgeClient};

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
#[test]
fn snapshot_get_receipt_by_index() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, token_addr, _token) = setup(&env);

    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;

    client.deposit(&depositor, &deposit_amount, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let receipt = client.get_receipt_by_index(&0u64);
    assert!(receipt.is_some(), "Receipt at index 0 should exist");

    if let Some(receipt_data) = receipt {
        // Receipt struct has: id, depositor, amount, ledger, reference, refunded, memo_hash
        let _id = receipt_data.id.clone();
        let _depositor_addr = receipt_data.depositor.clone();
        let _amount = receipt_data.amount;
        let _ledger = receipt_data.ledger;
        let _refunded = receipt_data.refunded;

        assert_eq!(receipt_data.depositor, depositor, "Depositor should match");
        assert_eq!(receipt_data.amount, deposit_amount, "Amount should match");
        assert!(receipt_data.ledger > 0, "Ledger should be set");
        assert!(!receipt_data.refunded, "Receipt should not be refunded");
    }
}

/// Snapshot test for get_receipt_by_index with non-existent index.
#[test]
fn snapshot_get_receipt_by_index_nonexistent() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_addr, _token) = setup(&env);

    let receipt = client.get_receipt_by_index(&999u64);
    assert!(receipt.is_none(), "Receipt at non-existent index should be None");
}

/// Snapshot test for get_accrued_fees.
#[test]
fn snapshot_get_accrued_fees() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, token_addr, _token) = setup(&env);

    let initial_fees = client.get_accrued_fees(&token_addr);
    assert_eq!(initial_fees, 0i128, "Initial accrued fees should be 0");
}

/// Snapshot test for get_total_deposited — returns i128 directly.
#[test]
fn snapshot_get_total_deposited() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, token_addr, _token) = setup(&env);

    let initial_total = client.get_total_deposited();
    assert_eq!(initial_total, 0i128, "Initial total deposited should be 0");

    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;
    client.deposit(&depositor, &deposit_amount, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let updated_total = client.get_total_deposited();
    assert_eq!(updated_total, deposit_amount, "Total deposited should equal the deposit amount");
}

/// Snapshot test for cumulative get_total_deposited.
#[test]
fn snapshot_get_total_deposited_cumulative() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, token_addr, _token) = setup(&env);

    let depositor1 = Address::generate(&env);
    let depositor2 = Address::generate(&env);
    let deposit1 = 1_000_000i128;
    let deposit2 = 2_000_000i128;

    client.deposit(&depositor1, &deposit1, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let total_after_first = client.get_total_deposited();
    assert_eq!(total_after_first, deposit1);

    client.deposit(&depositor2, &deposit2, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let total_after_second = client.get_total_deposited();
    assert_eq!(total_after_second, deposit1 + deposit2, "Total deposited should be cumulative");
}

/// Snapshot test for receipt field immutability.
#[test]
fn snapshot_receipt_field_immutability() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);

    let (client, _admin, token_addr, _token) = setup(&env);

    let depositor = Address::generate(&env);
    let deposit_amount: i128 = 1_000_000;
    let block_ledger = env.ledger().sequence();

    client.deposit(&depositor, &deposit_amount, &token_addr, &Bytes::new(&env), &0, &0, &None);

    let receipt = client.get_receipt_by_index(&0u64).expect("Receipt should exist");

    assert_eq!(receipt.depositor, depositor, "Depositor should match");
    assert_eq!(receipt.amount, deposit_amount, "Amount should match");
    assert!(receipt.ledger >= block_ledger, "Ledger should be >= block ledger");

    // Idempotent reads
    let receipt_id_again = client.get_receipt_by_index(&0u64).unwrap().id;
    assert_eq!(receipt_id_again, receipt.id, "Receipt id should be same on repeated reads");
}
