//! Boundary-check tests for `get_receipt_by_index`.
//!
//! The function used to return `Option<Receipt>`, conflating "out of range"
//! with "missing/expired entry". It now returns `Result<Receipt, Error>`
//! with explicit variants so callers (and on-chain consumers that compose
//! state on top of receipts) can react to the precise failure mode.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    vec, Address, Bytes, Env,
};

fn setup_bridge<'a>(env: &Env) -> (Address, FiatBridgeClient<'a>, Address, Address, StellarAssetClient<'a>) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_sac = StellarAssetClient::new(env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &10_000, &1, &signers, &1);

    (contract_id, bridge, admin, token_addr, token_sac)
}

/// Out-of-bounds: empty contract — any index is past `ReceiptCounter == 0`.
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

/// Boundary: with `n` receipts, `idx == n` is the first invalid index and
/// must be rejected as out of bounds (not silently returned as missing).
#[test]
fn out_of_bounds_at_exact_counter_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    // Issue two receipts → counter = 2.
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Valid indices.
    assert_eq!(bridge.get_receipt_by_index(&0).amount, 100);
    assert_eq!(bridge.get_receipt_by_index(&1).amount, 200);

    // First invalid index — must be ReceiptIndexOutOfBounds.
    assert_eq!(
        bridge.try_get_receipt_by_index(&2),
        Err(Ok(Error::ReceiptIndexOutOfBounds))
    );
}

/// `idx == u64::MAX` must short-circuit on the bounds check rather than
/// computing a storage key — that's the state-explosion vector the boundary
/// check exists to prevent.
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

/// In-range index whose temporary `ReceiptIndex` entry has been removed
/// must surface as `ReceiptNotFound`, distinct from out-of-bounds.
#[test]
fn receipt_not_found_when_index_entry_missing() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, token_addr, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Force the index entry to disappear without decrementing the
    // ReceiptCounter — this models TTL expiry on temporary storage.
    env.as_contract(&contract_id, || {
        env.storage().temporary().remove(&DataKey::ReceiptIndex(0));
    });

    // Counter is still 1, so 0 is in range — but the index entry is gone.
    assert_eq!(
        bridge.try_get_receipt_by_index(&0),
        Err(Ok(Error::ReceiptNotFound))
    );
}

/// In-range index with an index entry but a missing persistent receipt.
/// Must also surface as `ReceiptNotFound` (not panic, not OOB).
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
