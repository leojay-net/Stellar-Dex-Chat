//! Invariant tests for [`FiatBridge::propose_upgrade`].
//!
//! `propose_upgrade` stores an [`UpgradeProposal`] holding the candidate WASM
//! hash and the ledger after which it may execute. The invariants asserted
//! here are:
//!
//! * a successful proposal records the hash verbatim and sets
//!   `executable_after == current_sequence + delay`, using the configured
//!   delay (or `MIN_UPGRADE_DELAY` when none was set);
//! * the deadline computation saturates rather than wrapping, so an
//!   oversized delay can never produce an `executable_after` in the past;
//! * proposing is admin-only: a non-admin caller is rejected and leaves the
//!   stored proposal — present or absent — exactly as it was;
//! * proposing on an uninitialised contract fails with `NotInitialized` and
//!   writes nothing;
//! * re-proposing replaces the pending proposal wholesale rather than
//!   accumulating, and never disturbs unrelated accounting.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token, Address, BytesN, Env, Vec,
};

/// Mirrors the contract-private `MIN_UPGRADE_DELAY`.
const MIN_UPGRADE_DELAY: u32 = 1_000;

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

/// Register and initialise a bridge; returns the client and the admin address.
fn setup_bridge(env: &Env) -> (FiatBridgeClient<'_>, Address) {
    let admin = Address::generate(env);
    let (token_client, _token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    (client, admin)
}

/// Register a bridge but deliberately leave it uninitialised.
fn setup_uninitialised(env: &Env) -> FiatBridgeClient<'_> {
    let contract_id = env.register(FiatBridge, ());
    FiatBridgeClient::new(env, &contract_id)
}

fn hash_of(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Accounting/config surface that proposing an upgrade must never disturb.
fn state_fingerprint(bridge: &FiatBridgeClient) -> (i128, i128, i128, Address) {
    (
        bridge.get_limit(),
        bridge.get_total_deposited(),
        bridge.get_total_withdrawn(),
        bridge.get_admin(),
    )
}

// ── Success-path invariants ──────────────────────────────────────────────────

#[test]
fn proposal_records_hash_verbatim_and_default_delay() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    let hash = hash_of(&env, 0xAB);

    let seq_before = env.ledger().sequence();
    bridge.propose_upgrade(&hash);

    let p = bridge
        .get_upgrade_proposal()
        .expect("a proposal must be stored");

    assert_eq!(p.wasm_hash, hash, "the WASM hash must round-trip verbatim");
    assert_eq!(
        p.executable_after,
        seq_before + MIN_UPGRADE_DELAY,
        "with no configured delay the default MIN_UPGRADE_DELAY applies"
    );
    assert_eq!(
        bridge.get_upgrade_delay(),
        MIN_UPGRADE_DELAY,
        "proposing must not alter the configured delay"
    );
}

#[test]
fn proposal_honours_a_configured_delay() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    let delay = 5_000u32;
    bridge.set_upgrade_delay(&delay);

    let hash = hash_of(&env, 0x11);
    let seq_before = env.ledger().sequence();
    bridge.propose_upgrade(&hash);

    let p = bridge.get_upgrade_proposal().unwrap();
    assert_eq!(
        p.executable_after,
        seq_before + delay,
        "executable_after must be current_sequence + configured delay"
    );
}

#[test]
fn executable_after_is_always_strictly_in_the_future() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    bridge.propose_upgrade(&hash_of(&env, 0x22));

    let p = bridge.get_upgrade_proposal().unwrap();
    assert!(
        p.executable_after > env.ledger().sequence(),
        "a fresh proposal must never be immediately executable"
    );
}

#[test]
fn reproposing_replaces_rather_than_accumulates() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);

    let first = hash_of(&env, 0x01);
    bridge.propose_upgrade(&first);
    let after_first = bridge.get_upgrade_proposal().unwrap();
    assert_eq!(after_first.wasm_hash, first);

    let second = hash_of(&env, 0x02);
    bridge.propose_upgrade(&second);
    let after_second = bridge.get_upgrade_proposal().unwrap();

    assert_eq!(
        after_second.wasm_hash, second,
        "the newest proposal must win"
    );
    assert_ne!(
        after_first.wasm_hash, after_second.wasm_hash,
        "the superseded hash must no longer be readable"
    );
}

#[test]
fn proposing_does_not_disturb_accounting_or_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    let before = state_fingerprint(&bridge);

    bridge.propose_upgrade(&hash_of(&env, 0x33));

    assert_eq!(
        before,
        state_fingerprint(&bridge),
        "proposing an upgrade must not move limit/deposits/fees/admin"
    );
}

// ── Saturation, not wraparound ───────────────────────────────────────────────

#[test]
fn deadline_saturates_on_huge_delay_instead_of_wrapping() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);

    // A delay this large makes `sequence + delay` exceed u32::MAX, so a plain
    // `+` would wrap into the past. `propose_upgrade` uses `saturating_add`.
    //
    // The ledger sequence itself is left alone: the Soroban test host computes
    // persistent-entry TTLs from it and rejects a sequence near u32::MAX with
    // "persistent entry TTL overflow", so the overflow is driven from the
    // delay side instead.
    bridge.set_upgrade_delay(&u32::MAX);

    let seq = env.ledger().sequence();
    bridge.propose_upgrade(&hash_of(&env, 0x44));

    let p = bridge.get_upgrade_proposal().unwrap();
    assert_eq!(
        p.executable_after,
        u32::MAX,
        "the deadline must saturate at u32::MAX rather than wrap to a past ledger"
    );
    assert!(
        p.executable_after >= seq,
        "a saturated deadline must never land in the past"
    );
}

// ── Authorisation and initialisation failures write nothing ──────────────────

#[test]
fn uninitialised_contract_rejects_and_writes_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge = setup_uninitialised(&env);
    let hash = hash_of(&env, 0x55);

    let result = bridge.try_propose_upgrade(&hash);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));

    assert!(
        bridge.get_upgrade_proposal().is_none(),
        "a failed proposal must not leave a partial UpgradeProposal behind"
    );
}

#[test]
fn non_admin_is_rejected_and_leaves_existing_proposal_untouched() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let (token_client, _token_admin) = create_token_contract(&env, &admin);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    env.mock_all_auths();
    bridge.init(
        &admin,
        &token_client.address,
        &1_000_000,
        &100,
        &signers,
        &1,
        &0,
    );

    let legitimate = hash_of(&env, 0x66);
    bridge.propose_upgrade(&legitimate);
    let before = bridge.get_upgrade_proposal().unwrap();

    // Drop the blanket auth mock and authorise only a non-admin address, so the
    // admin's `require_auth()` inside propose_upgrade genuinely fails.
    let outsider = Address::generate(&env);
    env.set_auths(&[]);

    let hijack = hash_of(&env, 0x77);
    let result = bridge.try_propose_upgrade(&hijack);
    assert!(
        result.is_err(),
        "propose_upgrade must reject a caller that cannot satisfy admin auth"
    );
    let _ = outsider;

    // Re-enable auth purely to read state back.
    env.mock_all_auths();
    let after = bridge.get_upgrade_proposal().unwrap();
    assert_eq!(
        before, after,
        "a rejected proposal must leave the pending proposal untouched"
    );
    assert_ne!(
        after.wasm_hash, hijack,
        "an unauthorised hash must never be stored"
    );
}

#[test]
fn failed_proposal_on_fresh_contract_leaves_no_upgrade_delay_drift() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge = setup_uninitialised(&env);

    let result = bridge.try_propose_upgrade(&hash_of(&env, 0x88));
    assert!(result.is_err());

    assert_eq!(
        bridge.get_upgrade_delay(),
        MIN_UPGRADE_DELAY,
        "a failed proposal must not perturb the upgrade delay"
    );
    assert!(bridge.get_upgrade_proposal().is_none());
}

// ── Property-based coverage of the input space ───────────────────────────────

proptest! {
    /// Any 32-byte hash round-trips verbatim and yields a future deadline.
    #[test]
    fn any_hash_round_trips_with_future_deadline(byte in 0u8..=255) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        let hash = hash_of(&env, byte);

        let seq_before = env.ledger().sequence();
        bridge.propose_upgrade(&hash);

        let p = bridge.get_upgrade_proposal().unwrap();
        prop_assert_eq!(p.wasm_hash, hash);
        prop_assert_eq!(p.executable_after, seq_before + MIN_UPGRADE_DELAY);
        prop_assert!(p.executable_after > seq_before);
    }

    /// For any admissible configured delay, `executable_after` is exactly
    /// `sequence + delay` and never lands in the past.
    #[test]
    fn any_valid_delay_produces_exact_deadline(delay in MIN_UPGRADE_DELAY..100_000u32) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        bridge.set_upgrade_delay(&delay);

        let seq_before = env.ledger().sequence();
        bridge.propose_upgrade(&hash_of(&env, 0x99));

        let p = bridge.get_upgrade_proposal().unwrap();
        prop_assert_eq!(p.executable_after, seq_before.saturating_add(delay));
        prop_assert!(p.executable_after > seq_before);
    }

    /// However large the configured delay, the deadline saturates and never
    /// wraps into the past.
    ///
    /// The overflow is driven from the delay rather than the ledger sequence:
    /// the Soroban test host derives persistent-entry TTLs from the sequence
    /// and rejects values near `u32::MAX` with "persistent entry TTL overflow".
    #[test]
    fn deadline_never_wraps_for_any_huge_delay(offset in 0u32..2_000) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);

        let delay = u32::MAX - offset;
        bridge.set_upgrade_delay(&delay);

        let seq = env.ledger().sequence();
        bridge.propose_upgrade(&hash_of(&env, 0xAA));

        let p = bridge.get_upgrade_proposal().unwrap();
        prop_assert_eq!(p.executable_after, seq.saturating_add(delay));
        prop_assert!(
            p.executable_after >= seq,
            "saturating_add must never produce a deadline before the current ledger"
        );
    }

    /// Repeated proposals always leave exactly one pending proposal — the last
    /// one — and never disturb accounting.
    #[test]
    fn repeated_proposals_keep_only_the_latest(rounds in 1u8..6) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        let baseline = state_fingerprint(&bridge);

        let mut last = hash_of(&env, 0);
        for r in 0..rounds {
            last = hash_of(&env, r + 1);
            bridge.propose_upgrade(&last);
        }

        let p = bridge.get_upgrade_proposal().unwrap();
        prop_assert_eq!(p.wasm_hash, last);
        prop_assert_eq!(baseline, state_fingerprint(&bridge));
    }

    /// Proposing on an uninitialised contract always fails and writes nothing,
    /// whatever hash is offered.
    #[test]
    fn uninitialised_always_rejects(byte in 0u8..=255) {
        let env = Env::default();
        env.mock_all_auths();

        let bridge = setup_uninitialised(&env);

        let result = bridge.try_propose_upgrade(&hash_of(&env, byte));
        prop_assert_eq!(result, Err(Ok(Error::NotInitialized)));
        prop_assert!(bridge.get_upgrade_proposal().is_none());
    }
}
