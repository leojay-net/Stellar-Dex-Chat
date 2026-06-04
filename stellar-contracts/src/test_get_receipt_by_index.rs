//! Comprehensive tests for `get_receipt_by_index`.
//!
//! The function returns `Result<Receipt, Error>` with two distinct failure
//! variants so callers can react to the precise failure mode:
//!
//! * [`Error::ReceiptIndexOutOfBounds`] -- `idx >= ReceiptCounter`
//! * [`Error::ReceiptNotFound`]         -- index entry or receipt is gone (TTL / manual removal)

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    vec, Address, Bytes, BytesN, Env,
};

fn setup_bridge<'a>(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'a>,
    Address,
    Address,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_sac = StellarAssetClient::new(env, &token_addr);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000_000, &1, &signers, &1);
    // Set a generous per-token limit so deposits are not blocked by ExceedsLimit.
    bridge.set_limit(&token_addr, &1_000_000_000i128);
    (contract_id, bridge, admin, token_addr, token_sac)
}

// ── Out-of-bounds tests ───────────────────────────────────────────────────────

/// Empty contract -- ReceiptCounter == 0, so every index is OOB.
#[test]
fn out_of_bounds_when_no_receipts_have_been_issued() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, _, _) = setup_bridge(&env);
    assert_eq!(
        bridge.try_get_receipt_by_index(&0),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
    assert_eq!(
        bridge.try_get_receipt_by_index(&u64::MAX),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
}

/// With n receipts, idx == n is the first invalid index (OOB, not missing).
#[test]
fn out_of_bounds_at_exact_counter_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 100);
    assert_eq!(bridge.get_receipt_by_index(&1).amount, 200);
    assert_eq!(
        bridge.try_get_receipt_by_index(&2),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
}

/// u64::MAX must short-circuit on the bounds check regardless of counter value.
#[test]
fn out_of_bounds_for_u64_max_index() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(
        bridge.try_get_receipt_by_index(&u64::MAX),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
}

/// With exactly one receipt, idx == 1 must be OOB (valid range is [0, 0]).
#[test]
fn out_of_bounds_idx_equals_one_when_one_receipt_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(
        bridge.try_get_receipt_by_index(&1),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
}

// ── ReceiptNotFound tests ─────────────────────────────────────────────────────

/// In-range index whose temporary ReceiptIndex entry has been removed
/// (models TTL expiry) must surface as ReceiptNotFound, not OOB.
#[test]
fn receipt_not_found_when_index_entry_missing() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    env.as_contract(&contract_id, || {
        env.storage().temporary().remove(&DataKey::ReceiptIndex(0));
    });
    assert_eq!(
        bridge.try_get_receipt_by_index(&0),
        Err(Ok(Error::ReceiptNotFound))
    );
}

/// In-range index with a valid index entry but a missing persistent receipt
/// must also surface as ReceiptNotFound (not panic, not OOB).
#[test]
fn receipt_not_found_when_persistent_entry_missing() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    let receipt_hash =
        bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Drop the persistent Receipt entry, leave the index pointing to it.
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .remove(&DataKey::Receipt(receipt_hash));
    });
    assert_eq!(
        bridge.try_get_receipt_by_index(&0),
        Err(Ok(Error::ReceiptNotFound))
    );
}

/// Removing the middle receipt in a 3-receipt set must not affect the other two.
#[test]
fn receipt_not_found_does_not_affect_sibling_indices() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    bridge.deposit(&user, &111, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let hash_1 =
        bridge.deposit(&user, &222, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &333, &token_addr, &Bytes::new(&env), &0, &0, &None);
    env.as_contract(&contract_id, || {
        env.storage().persistent().remove(&DataKey::Receipt(hash_1));
    });
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 111);
    assert_eq!(
        bridge.try_get_receipt_by_index(&1),
        Err(Ok(Error::ReceiptNotFound))
    );
    assert_eq!(bridge.get_receipt_by_index(&2).amount, 333);
}

// ── Happy-path / field-correctness tests ─────────────────────────────────────

/// A single deposit must be retrievable at idx 0 with every field correct.
#[test]
fn happy_path_single_receipt_all_fields() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"ref-abc");
    let expected_id =
        bridge.deposit(&user, &500, &token_addr, &reference, &0, &0, &None);
    let receipt = bridge.get_receipt_by_index(&0);
    assert_eq!(receipt.id, expected_id, "receipt id mismatch");
    assert_eq!(receipt.depositor, user, "depositor mismatch");
    assert_eq!(receipt.amount, 500, "amount mismatch");
    assert_eq!(receipt.reference, reference, "reference mismatch");
    assert!(!receipt.refunded, "newly issued receipt must not be refunded");
    assert_eq!(receipt.memo_hash, None, "memo_hash should be None");
}

/// A receipt issued with a memo_hash must preserve that field round-trip.
#[test]
fn happy_path_receipt_preserves_memo_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);
    let memo: BytesN<32> = BytesN::from_array(&env, &[7u8; 32]);
    bridge.deposit(
        &user,
        &100,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &Some(memo.clone()),
    );
    let receipt = bridge.get_receipt_by_index(&0);
    assert_eq!(receipt.memo_hash, Some(memo));
}

/// Multiple deposits must be retrievable in strict insertion order.
#[test]
fn sequential_indices_preserve_insertion_order() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);
    let amounts = [100i128, 200, 300, 400, 500];
    for &amt in &amounts {
        bridge.deposit(&user, &amt, &token_addr, &Bytes::new(&env), &0, &0, &None);
    }
    for (i, &expected) in amounts.iter().enumerate() {
        assert_eq!(
            bridge.get_receipt_by_index(&(i as u64)).amount,
            expected,
            "wrong amount at index {i}"
        );
    }
}

/// idx == n-1 (last valid) must succeed; idx == n must return OOB.
#[test]
fn last_valid_index_succeeds_and_next_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);
    let n = 5u64;
    for i in 0..n {
        bridge.deposit(
            &user,
            &((i + 1) as i128 * 10),
            &token_addr,
            &Bytes::new(&env),
            &0,
            &0,
            &None,
        );
    }
    assert_eq!(bridge.get_receipt_by_index(&(n - 1)).amount, n as i128 * 10);
    assert_eq!(
        bridge.try_get_receipt_by_index(&n),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
}

/// Receipts from different depositors must be independently retrievable with
/// the correct depositor field at each index.
#[test]
fn receipts_from_different_depositors_are_correctly_segregated() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_sac.mint(&alice, &5_000);
    token_sac.mint(&bob, &5_000);
    bridge.deposit(&alice, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&bob, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&alice, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let r0 = bridge.get_receipt_by_index(&0);
    let r1 = bridge.get_receipt_by_index(&1);
    let r2 = bridge.get_receipt_by_index(&2);
    assert_eq!(r0.depositor, alice);
    assert_eq!(r0.amount, 100);
    assert_eq!(r1.depositor, bob);
    assert_eq!(r1.amount, 200);
    assert_eq!(r2.depositor, alice);
    assert_eq!(r2.amount, 300);
}

/// Reading the same index twice must return an identical receipt (idempotency).
#[test]
fn reading_same_index_twice_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &750, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let first = bridge.get_receipt_by_index(&0);
    let second = bridge.get_receipt_by_index(&0);
    assert_eq!(first.id, second.id);
    assert_eq!(first.amount, second.amount);
    assert_eq!(first.depositor, second.depositor);
}

/// The ID returned by deposit must equal the id field inside the stored receipt.
#[test]
fn receipt_id_returned_by_deposit_matches_stored_receipt() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    let deposit_id =
        bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let receipt = bridge.get_receipt_by_index(&0);
    assert_eq!(deposit_id, receipt.id);
}

/// Pre-existing receipts at lower indices must remain stable after more deposits.
#[test]
fn previously_issued_receipts_remain_stable_as_more_are_added() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);
    bridge.deposit(&user, &10, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 10);
    bridge.deposit(&user, &20, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 10);
    assert_eq!(bridge.get_receipt_by_index(&1).amount, 20);
    bridge.deposit(&user, &30, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 10);
    assert_eq!(bridge.get_receipt_by_index(&1).amount, 20);
    assert_eq!(bridge.get_receipt_by_index(&2).amount, 30);
}

/// Non-empty reference bytes must round-trip correctly through the index lookup.
#[test]
fn receipt_reference_bytes_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    let reference = Bytes::from_slice(&env, b"payment-ref-XYZ-001");
    bridge.deposit(&user, &100, &token_addr, &reference, &0, &0, &None);
    assert_eq!(bridge.get_receipt_by_index(&0).reference, reference);
}

/// A newly-issued receipt must always have refunded == false.
#[test]
fn newly_issued_receipt_is_not_refunded() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert!(!bridge.get_receipt_by_index(&0).refunded);
}

/// Two distinct deposits must produce unique receipt IDs (collision resistance).
#[test]
fn distinct_deposits_produce_distinct_receipt_ids() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);
    bridge.deposit(&user, &111, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &222, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let id0 = bridge.get_receipt_by_index(&0).id;
    let id1 = bridge.get_receipt_by_index(&1).id;
    assert_ne!(id0, id1, "receipt IDs must be unique across deposits");
}

/// idx == 0 with exactly one receipt is the tightest happy-path boundary.
#[test]
fn idx_zero_with_single_receipt_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &1_000);
    bridge.deposit(&user, &42, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 42);
}
