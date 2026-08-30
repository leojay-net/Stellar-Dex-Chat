//! Timelock invariants for [`FiatBridge::execute_upgrade`].
//!
//! [`test_execute_upgrade_invariants`](crate::test_execute_upgrade_invariants)
//! covers the two rejection codes and the "no proposal, no state change"
//! property. This module takes the timelock itself as its subject — the part
//! of `execute_upgrade` that decides *when* a proposal becomes executable:
//!
//! * the guard is `sequence < executable_after`, so the lock must still hold at
//!   `executable_after - 1` and release at exactly `executable_after` — never a
//!   ledger early, never a ledger late, for any configured delay;
//! * a rejected execution is inert: the pending proposal keeps its hash and
//!   deadline verbatim, the configured delay is unmoved and the accounting
//!   surface is untouched, however many times it is retried;
//! * cancelling a proposal makes execution fail with `UpgradeProposalMissing`
//!   even past the original deadline, rather than resurrecting the cancelled
//!   hash;
//! * re-proposing re-arms the lock, so a deadline already reached under the
//!   superseded proposal cannot be reused to execute the replacement early.
//!
//! On the success path: a genuine `execute_upgrade` calls
//! `env.deployer().update_current_contract_wasm(..)`, which the test host only
//! accepts for a hash that was actually uploaded. Rather than depend on the
//! SDK's doctest WASM fixture (whose registry path is version-pinned and
//! routinely absent — see `test::load_valid_contract_wasm_fixture`), the
//! boundary tests assert on the guard itself: at and after `executable_after`
//! the call no longer returns `UpgradeNotReady`, and instead aborts deeper in
//! on the unuploaded hash. `test::test_execute_upgrade_after_delay_succeeds`
//! covers the full success path where the fixture is available.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, token, Address, BytesN, Env, Vec};

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

fn hash_of(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Move the ledger sequence to an absolute value.
fn set_sequence(env: &Env, sequence: u32) {
    env.ledger().with_mut(|li| li.sequence_number = sequence);
}

/// Accounting/config surface that a *rejected* upgrade must never disturb.
fn state_fingerprint(bridge: &FiatBridgeClient) -> (i128, i128, i128, Address, u32) {
    (
        bridge.get_limit(),
        bridge.get_total_deposited(),
        bridge.get_total_withdrawn(),
        bridge.get_admin(),
        bridge.get_upgrade_delay(),
    )
}

// ── The timelock boundary ────────────────────────────────────────────────────

#[test]
fn the_deadline_is_not_reached_one_ledger_early() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    bridge.propose_upgrade(&hash_of(&env, 0x22));
    let deadline = bridge.get_upgrade_proposal().unwrap().executable_after;

    set_sequence(&env, deadline - 1);
    assert_eq!(
        bridge.try_execute_upgrade(),
        Err(Ok(Error::UpgradeNotReady)),
        "the timelock must still hold at executable_after - 1"
    );
}

#[test]
fn the_timelock_releases_exactly_at_the_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    bridge.propose_upgrade(&hash_of(&env, 0x33));
    let deadline = bridge.get_upgrade_proposal().unwrap().executable_after;

    set_sequence(&env, deadline);

    // The guard is `sequence < executable_after`, so at the deadline the call
    // proceeds past it. It then fails deeper in, on the unuploaded WASM hash —
    // what matters here is that it is no longer refused *by the timelock*.
    assert_ne!(
        bridge.try_execute_upgrade(),
        Err(Ok(Error::UpgradeNotReady)),
        "the timelock must release at exactly executable_after, not later"
    );
}

// ── A rejected execution is inert ────────────────────────────────────────────

#[test]
fn a_rejected_execution_leaves_the_proposal_verbatim() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    let hash = hash_of(&env, 0x44);
    bridge.propose_upgrade(&hash);

    let before_proposal = bridge.get_upgrade_proposal().unwrap();
    let before_state = state_fingerprint(&bridge);

    assert_eq!(
        bridge.try_execute_upgrade(),
        Err(Ok(Error::UpgradeNotReady))
    );

    let after_proposal = bridge.get_upgrade_proposal().unwrap();
    assert_eq!(
        before_proposal, after_proposal,
        "a premature execution must not consume or mutate the pending proposal"
    );
    assert_eq!(after_proposal.wasm_hash, hash);
    assert_eq!(
        before_state,
        state_fingerprint(&bridge),
        "a premature execution must not move accounting or the upgrade delay"
    );
}

#[test]
fn repeated_premature_executions_never_wear_the_timelock_down() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    bridge.propose_upgrade(&hash_of(&env, 0x55));
    let before = bridge.get_upgrade_proposal().unwrap();

    for _ in 0..10 {
        assert_eq!(
            bridge.try_execute_upgrade(),
            Err(Ok(Error::UpgradeNotReady)),
            "retrying must not eventually succeed"
        );
    }

    assert_eq!(
        before,
        bridge.get_upgrade_proposal().unwrap(),
        "the deadline must not creep closer with each rejected attempt"
    );
}

// ── Cancellation and replacement ─────────────────────────────────────────────

#[test]
fn a_cancelled_proposal_cannot_be_executed() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, admin) = setup_bridge(&env);
    let hash = hash_of(&env, 0x66);
    bridge.propose_upgrade(&hash);
    let deadline = bridge.get_upgrade_proposal().unwrap().executable_after;

    bridge.cancel_upgrade(&bridge.get_upgrade_cancellation_nonce(&admin));
    assert!(bridge.get_upgrade_proposal().is_none());

    // Even past the original deadline the cancelled hash must stay unreachable.
    set_sequence(&env, deadline + 1);
    assert_eq!(
        bridge.try_execute_upgrade(),
        Err(Ok(Error::UpgradeProposalMissing)),
        "cancellation must not leave the hash executable"
    );
}

#[test]
fn re_proposing_re_arms_the_timelock() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    bridge.propose_upgrade(&hash_of(&env, 0x77));
    let first_deadline = bridge.get_upgrade_proposal().unwrap().executable_after;

    // Advance to the point where the first proposal would have been executable,
    // then replace it. The replacement must get a fresh, later deadline.
    set_sequence(&env, first_deadline);
    let second = hash_of(&env, 0x88);
    bridge.propose_upgrade(&second);

    let p = bridge.get_upgrade_proposal().unwrap();
    assert_eq!(p.wasm_hash, second);
    assert!(
        p.executable_after > first_deadline,
        "a replacement proposal must not inherit the elapsed deadline"
    );
    assert_eq!(
        bridge.try_execute_upgrade(),
        Err(Ok(Error::UpgradeNotReady)),
        "re-proposing must not open a window to execute the new hash immediately"
    );
}

// ── Property-based coverage of the input space ───────────────────────────────

proptest! {
    /// For any 32-byte hash, a fresh proposal is never immediately executable
    /// and the rejection leaves the hash intact.
    #[test]
    fn any_hash_is_timelocked_on_proposal(byte in 0u8..=255) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        let hash = hash_of(&env, byte);
        bridge.propose_upgrade(&hash);

        prop_assert_eq!(
            bridge.try_execute_upgrade(),
            Err(Ok(Error::UpgradeNotReady))
        );

        let p = bridge.get_upgrade_proposal().unwrap();
        prop_assert_eq!(p.wasm_hash, hash);
    }

    /// At every ledger strictly below `executable_after`, execution is refused.
    #[test]
    fn every_ledger_before_the_deadline_is_refused(offset in 0u32..MIN_UPGRADE_DELAY) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        bridge.propose_upgrade(&hash_of(&env, 0x99));

        let p = bridge.get_upgrade_proposal().unwrap();
        let deadline = p.executable_after;

        set_sequence(&env, deadline - 1 - offset);
        prop_assert_eq!(
            bridge.try_execute_upgrade(),
            Err(Ok(Error::UpgradeNotReady))
        );

        // The refusal is inert: the proposal survives byte-for-byte.
        prop_assert_eq!(bridge.get_upgrade_proposal().unwrap(), p);
    }

    /// However long the configured delay, the timelock spans exactly that many
    /// ledgers: refused at `deadline - 1`, released at `deadline`.
    #[test]
    fn the_timelock_spans_exactly_the_configured_delay(
        delay in MIN_UPGRADE_DELAY..50_000u32,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        bridge.set_upgrade_delay(&delay);

        let seq_before = env.ledger().sequence();
        bridge.propose_upgrade(&hash_of(&env, 0xAA));

        let deadline = bridge.get_upgrade_proposal().unwrap().executable_after;
        prop_assert_eq!(deadline, seq_before.saturating_add(delay));

        set_sequence(&env, deadline - 1);
        prop_assert_eq!(
            bridge.try_execute_upgrade(),
            Err(Ok(Error::UpgradeNotReady))
        );

        set_sequence(&env, deadline);
        prop_assert_ne!(
            bridge.try_execute_upgrade(),
            Err(Ok(Error::UpgradeNotReady))
        );
    }

    /// Any number of premature attempts leaves the proposal and the accounting
    /// surface bit-for-bit unchanged.
    #[test]
    fn premature_attempts_are_always_inert(attempts in 1u8..8) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        bridge.propose_upgrade(&hash_of(&env, 0xBB));

        let proposal_before = bridge.get_upgrade_proposal().unwrap();
        let state_before = state_fingerprint(&bridge);

        for _ in 0..attempts {
            prop_assert_eq!(
                bridge.try_execute_upgrade(),
                Err(Ok(Error::UpgradeNotReady))
            );
        }

        prop_assert_eq!(bridge.get_upgrade_proposal().unwrap(), proposal_before);
        prop_assert_eq!(state_fingerprint(&bridge), state_before);
    }
}
