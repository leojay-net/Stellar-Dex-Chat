//! Invariant tests for [`FiatBridge::get_multisig_proposal`].
//!
//! `get_multisig_proposal` is a read-only accessor over
//! `DataKey::MultisigProposal(id)`. The invariants asserted here are:
//!
//! * it is **pure** — no call, for any id, mutates any observable state;
//! * it faithfully reflects whatever the mutating entry points last wrote,
//!   tracking approvals and the `executed` flag exactly;
//! * an id that was never allocated reads back as `None` rather than
//!   panicking, and reading it does not create an entry;
//! * it is idempotent: repeated reads of the same id return equal values;
//! * it is not access-controlled — any caller observes the same value — so
//!   "unauthorised callers leave no state change" is asserted as read purity
//!   rather than as rejection.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

#![allow(clippy::explicit_counter_loop)]

use crate::{BatchAdminOp, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _, token, Address, Bytes, Env, Symbol, Vec,
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

/// Register a bridge whose multisig set has `signer_count` signers and the
/// given `threshold`. Returns the client plus the signer list.
fn setup_multisig(
    env: &Env,
    signer_count: u32,
    threshold: u32,
) -> (FiatBridgeClient<'_>, Vec<Address>) {
    let admin = Address::generate(env);
    let (token_client, _token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.init(
        &admin,
        &token_address,
        &1_000_000,
        &100,
        &signers,
        &threshold,
        &0,
    );

    (client, signers)
}

/// A no-op-ish admin action used purely as proposal payload.
fn sample_action(env: &Env) -> BatchAdminOp {
    BatchAdminOp {
        op_type: Symbol::new(env, "pause"),
        payload: Bytes::new(env),
    }
}

/// A cheap fingerprint of the accounting/config surface that a pure read must
/// never disturb.
fn state_fingerprint(bridge: &FiatBridgeClient) -> (Vec<Address>, i128, i128, i128) {
    (
        bridge.get_multisig_signers(),
        bridge.get_limit(),
        bridge.get_total_deposited(),
        bridge.get_total_withdrawn(),
    )
}

// ── Faithful reflection of written state ─────────────────────────────────────

#[test]
fn returns_exactly_what_propose_wrote() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let action = sample_action(&env);
    let id = bridge.propose_multisig_action(&proposer, &action);

    let p = bridge
        .get_multisig_proposal(&id)
        .expect("a freshly created proposal must be readable");

    assert_eq!(p.creator, proposer, "creator must match the proposer");
    assert_eq!(p.action, action, "action must round-trip unchanged");
    assert!(!p.executed, "a new proposal must not be marked executed");
    assert_eq!(
        p.approvals.len(),
        1,
        "a new proposal carries the proposer's implicit approval"
    );
    assert!(p.approvals.contains(&proposer));
}

#[test]
fn tracks_approvals_as_they_accumulate() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    for i in 1..signers.len() {
        let signer = signers.get(i).unwrap();
        bridge.approve_multisig_action(&signer, &id);

        let p = bridge.get_multisig_proposal(&id).unwrap();
        assert_eq!(
            p.approvals.len(),
            i + 1,
            "the accessor must reflect each new approval immediately"
        );
        assert!(p.approvals.contains(&signer));
    }
}

#[test]
fn tracks_revocations_as_they_happen() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let approver = signers.get(1).unwrap();
    bridge.approve_multisig_action(&approver, &id);
    assert!(bridge
        .get_multisig_proposal(&id)
        .unwrap()
        .approvals
        .contains(&approver));

    bridge.revoke_multisig_approval(&approver, &id);
    assert!(
        !bridge
            .get_multisig_proposal(&id)
            .unwrap()
            .approvals
            .contains(&approver),
        "the accessor must reflect a revocation immediately"
    );
}

#[test]
fn reflects_the_executed_flag_after_execution() {
    let env = Env::default();
    env.mock_all_auths();

    // threshold 1 => the proposer's own approval is enough to execute.
    let (bridge, signers) = setup_multisig(&env, 3, 1);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    assert!(!bridge.get_multisig_proposal(&id).unwrap().executed);

    bridge.execute_multisig_action(&id);

    let p = bridge.get_multisig_proposal(&id).unwrap();
    assert!(
        p.executed,
        "the accessor must report the executed flag once set"
    );
    assert_eq!(
        p.creator, proposer,
        "execution must not rewrite proposal authorship"
    );
}

#[test]
fn distinct_ids_return_distinct_independent_proposals() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer_a = signers.get(0).unwrap();
    let proposer_b = signers.get(1).unwrap();

    let id_a = bridge.propose_multisig_action(&proposer_a, &sample_action(&env));
    let id_b = bridge.propose_multisig_action(&proposer_b, &sample_action(&env));
    assert_ne!(id_a, id_b);

    let a = bridge.get_multisig_proposal(&id_a).unwrap();
    let b = bridge.get_multisig_proposal(&id_b).unwrap();

    assert_eq!(a.creator, proposer_a);
    assert_eq!(b.creator, proposer_b);
    assert_ne!(
        a.creator, b.creator,
        "each id must resolve to its own proposal, not a shared slot"
    );
}

// ── Missing ids read back as None ────────────────────────────────────────────

#[test]
fn unknown_id_returns_none_without_creating_an_entry() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _signers) = setup_multisig(&env, 3, 2);

    let missing_id = 987_654u64;
    assert!(
        bridge.get_multisig_proposal(&missing_id).is_none(),
        "an unallocated id must read back as None"
    );
    // Reading must not have materialised anything.
    assert!(
        bridge.get_multisig_proposal(&missing_id).is_none(),
        "reading a missing id must not create it"
    );
}

#[test]
fn reads_on_a_bridge_with_no_proposals_return_none() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _signers) = setup_multisig(&env, 3, 2);

    for id in 0u64..5 {
        assert!(
            bridge.get_multisig_proposal(&id).is_none(),
            "no proposal has been created, so every id must read as None"
        );
    }
}

// ── Purity: reads never mutate ───────────────────────────────────────────────

#[test]
fn repeated_reads_are_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let first = bridge.get_multisig_proposal(&id).unwrap();
    for _ in 0..10 {
        let again = bridge.get_multisig_proposal(&id).unwrap();
        assert_eq!(
            first, again,
            "repeated reads of the same id must return equal values"
        );
    }
}

#[test]
fn reading_does_not_disturb_accounting_or_config() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let before = state_fingerprint(&bridge);

    for probe in 0u64..20 {
        let _ = bridge.get_multisig_proposal(&probe);
        let _ = bridge.get_multisig_proposal(&id);
    }

    let after = state_fingerprint(&bridge);
    assert_eq!(
        before, after,
        "a read-only accessor must not move signers/limit/accounting totals"
    );
}

#[test]
fn unprivileged_caller_reads_the_same_value_without_mutating() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let as_signer = bridge.get_multisig_proposal(&id).unwrap();
    let fingerprint_before = state_fingerprint(&bridge);

    // `get_multisig_proposal` takes no caller argument and performs no
    // `require_auth`, so an outsider observes exactly the same value. The
    // "no state change" guarantee is therefore purity, asserted here.
    let outsider = Address::generate(&env);
    let _ = outsider;
    let as_outsider = bridge.get_multisig_proposal(&id).unwrap();

    assert_eq!(
        as_signer, as_outsider,
        "the accessor is not access-controlled; all callers see one value"
    );
    assert_eq!(
        fingerprint_before,
        state_fingerprint(&bridge),
        "an outsider's read must leave no state change"
    );
}

// ── Property-based coverage of the input space ───────────────────────────────

proptest! {
    /// For any id in a wide range, a bridge with no proposals returns `None`
    /// and the read leaves no trace.
    #[test]
    fn any_unallocated_id_reads_none(id in 0u64..u64::MAX) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _signers) = setup_multisig(&env, 3, 2);
        let before = state_fingerprint(&bridge);

        prop_assert!(bridge.get_multisig_proposal(&id).is_none());
        prop_assert_eq!(before, state_fingerprint(&bridge));
    }

    /// For any allocated proposal, the accessor round-trips the creator and
    /// action, and repeated reads stay equal.
    #[test]
    fn allocated_proposal_round_trips(
        signer_count in 2u32..6,
        proposer_idx in 0u32..6,
    ) {
        prop_assume!(proposer_idx < signer_count);

        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, signer_count, signer_count);
        let proposer = signers.get(proposer_idx).unwrap();
        let action = sample_action(&env);
        let id = bridge.propose_multisig_action(&proposer, &action);

        let first = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert_eq!(first.creator.clone(), proposer);
        prop_assert_eq!(first.action.clone(), action);
        prop_assert!(!first.executed);

        let second = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert_eq!(first, second);
    }

    /// The approval count the accessor reports always equals the number of
    /// approvals actually applied, for any number of approvers.
    #[test]
    fn reported_approval_count_matches_applied_approvals(
        signer_count in 2u32..6,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, signer_count, signer_count);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        for (i, expected) in (1..signers.len()).zip(2u32..) {
            bridge.approve_multisig_action(&signers.get(i).unwrap(), &id);
            let p = bridge.get_multisig_proposal(&id).unwrap();
            prop_assert_eq!(p.approvals.len(), expected);
        }
    }

    /// Any number of reads, against any mix of valid and invalid ids, leaves
    /// the observable state untouched.
    #[test]
    fn arbitrary_read_volume_is_pure(read_count in 1u32..30, probe in 0u64..1000) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 2);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let snapshot = bridge.get_multisig_proposal(&id).unwrap();
        let before = state_fingerprint(&bridge);

        for _ in 0..read_count {
            let _ = bridge.get_multisig_proposal(&probe);
            let _ = bridge.get_multisig_proposal(&id);
        }

        prop_assert_eq!(before, state_fingerprint(&bridge));
        prop_assert_eq!(snapshot, bridge.get_multisig_proposal(&id).unwrap());
    }
}
