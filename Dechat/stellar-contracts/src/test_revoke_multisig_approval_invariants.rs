//! Invariant tests for [`FiatBridge::revoke_multisig_approval`].
//!
//! `revoke_multisig_approval` removes the calling signer from a proposal's
//! approval list. The invariants asserted here are:
//!
//! * a successful revocation removes exactly one entry — the caller's — and
//!   leaves creator/action/`executed`/`created_at` untouched;
//! * revocation is the exact inverse of approval: approve-then-revoke restores
//!   the proposal to its pre-approval state;
//! * every rejected call (unknown id, executed proposal, caller who never
//!   approved) leaves storage byte-for-byte unchanged;
//! * unrelated proposals are never touched by a revocation on another id.
//!
//! Note on authorisation: unlike `approve_multisig_action`, the contract's
//! `revoke_multisig_approval` performs **no signer-set membership check**. It
//! gates purely on presence in the approvals list, so a non-signer is rejected
//! with `SignerNotFound` (not `Unauthorized`) because they cannot be in that
//! list. These tests pin that actual behaviour rather than an assumed one.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`; this file deliberately
//! carries no inner `#![cfg(test)]` so clippy's `duplicated_attributes` lint
//! stays quiet.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{BatchAdminOp, Error, FiatBridge, FiatBridgeClient, MultisigProposal};
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

/// Everything about a proposal that `revoke_multisig_approval` must not alter.
fn immutable_parts(p: &MultisigProposal) -> (Address, BatchAdminOp, bool, u32) {
    (
        p.creator.clone(),
        p.action.clone(),
        p.executed,
        p.created_at,
    )
}

/// True when `approvals` holds no duplicate address.
fn approvals_are_unique(p: &MultisigProposal) -> bool {
    let len = p.approvals.len();
    for i in 0..len {
        let a = p.approvals.get(i).unwrap();
        for j in (i + 1)..len {
            if a == p.approvals.get(j).unwrap() {
                return false;
            }
        }
    }
    true
}

// ── Success-path invariants ──────────────────────────────────────────────────

#[test]
fn revoke_removes_exactly_one_approval_and_preserves_the_rest() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let approver = signers.get(1).unwrap();
    bridge.approve_multisig_action(&approver, &id);

    let before = bridge.get_multisig_proposal(&id).unwrap();

    bridge.revoke_multisig_approval(&approver, &id);

    let after = bridge.get_multisig_proposal(&id).unwrap();

    assert_eq!(
        after.approvals.len(),
        before.approvals.len() - 1,
        "a successful revocation must remove exactly one entry"
    );
    assert!(
        !after.approvals.contains(&approver),
        "the revoking signer must no longer appear in the approvals list"
    );
    assert_eq!(
        immutable_parts(&before),
        immutable_parts(&after),
        "revocation must not alter creator/action/executed/created_at"
    );
    assert!(approvals_are_unique(&after));
}

#[test]
fn revoke_is_the_exact_inverse_of_approve() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let baseline = bridge.get_multisig_proposal(&id).unwrap();

    let approver = signers.get(2).unwrap();
    bridge.approve_multisig_action(&approver, &id);
    bridge.revoke_multisig_approval(&approver, &id);

    let restored = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        baseline, restored,
        "approve followed by revoke must restore the original proposal exactly"
    );
}

#[test]
fn revoke_only_removes_the_caller_leaving_other_approvals_intact() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let a = signers.get(1).unwrap();
    let b = signers.get(2).unwrap();
    let c = signers.get(3).unwrap();
    bridge.approve_multisig_action(&a, &id);
    bridge.approve_multisig_action(&b, &id);
    bridge.approve_multisig_action(&c, &id);

    bridge.revoke_multisig_approval(&b, &id);

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert!(!after.approvals.contains(&b), "revoker must be removed");
    assert!(after.approvals.contains(&a), "other approvals must survive");
    assert!(after.approvals.contains(&c), "other approvals must survive");
    assert!(
        after.approvals.contains(&proposer),
        "the proposer's implicit approval must survive"
    );
    assert_eq!(after.approvals.len(), 3);
    assert!(approvals_are_unique(&after));
}

#[test]
fn proposer_can_revoke_their_own_implicit_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 3);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let before = bridge.get_multisig_proposal(&id).unwrap();
    assert!(before.approvals.contains(&proposer));

    bridge.revoke_multisig_approval(&proposer, &id);

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert!(
        !after.approvals.contains(&proposer),
        "the proposer must be able to withdraw their own approval"
    );
    assert_eq!(after.approvals.len(), 0);
    assert_eq!(
        after.creator, proposer,
        "revoking an approval must not clear authorship of the proposal"
    );
    assert_eq!(immutable_parts(&before), immutable_parts(&after));
}

// ── Rejection paths leave no state change ────────────────────────────────────

#[test]
fn revoke_without_prior_approval_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let before = bridge.get_multisig_proposal(&id).unwrap();

    // A legitimate signer who never approved this proposal.
    let non_approver = signers.get(1).unwrap();
    let result = bridge.try_revoke_multisig_approval(&non_approver, &id);
    assert_eq!(result, Err(Ok(Error::SignerNotFound)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        before, after,
        "revoking without a prior approval must be a complete no-op"
    );
}

#[test]
fn outsider_revoke_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let before = bridge.get_multisig_proposal(&id).unwrap();

    // `revoke_multisig_approval` has no signer-set check; an outsider is
    // rejected because they cannot be present in the approvals list.
    let outsider = Address::generate(&env);
    let result = bridge.try_revoke_multisig_approval(&outsider, &id);
    assert_eq!(result, Err(Ok(Error::SignerNotFound)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        before, after,
        "an unauthorised revocation must not mutate the proposal"
    );
}

#[test]
fn double_revoke_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let approver = signers.get(1).unwrap();
    bridge.approve_multisig_action(&approver, &id);
    bridge.revoke_multisig_approval(&approver, &id);

    let before = bridge.get_multisig_proposal(&id).unwrap();

    let result = bridge.try_revoke_multisig_approval(&approver, &id);
    assert_eq!(result, Err(Ok(Error::SignerNotFound)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(before, after, "a second revocation must be a no-op");
}

#[test]
fn unknown_proposal_id_is_rejected_and_creates_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let signer = signers.get(0).unwrap();

    let missing_id = 424_242u64;
    let result = bridge.try_revoke_multisig_approval(&signer, &missing_id);
    assert_eq!(result, Err(Ok(Error::ProposalNotFound)));

    assert!(
        bridge.get_multisig_proposal(&missing_id).is_none(),
        "revoking against an unknown id must not conjure a proposal into storage"
    );
}

#[test]
fn revoke_after_execution_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    // threshold 1 => the proposer's own approval is already enough to execute.
    let (bridge, signers) = setup_multisig(&env, 3, 1);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    bridge.execute_multisig_action(&id);

    let before = bridge.get_multisig_proposal(&id).unwrap();
    assert!(before.executed, "proposal should be marked executed");

    let result = bridge.try_revoke_multisig_approval(&proposer, &id);
    assert_eq!(result, Err(Ok(Error::ProposalAlreadyExecuted)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        before, after,
        "an executed proposal's approvals must be frozen"
    );
    assert!(
        after.approvals.contains(&proposer),
        "execution-time approvals must remain on record"
    );
}

// ── Cross-proposal isolation ─────────────────────────────────────────────────

#[test]
fn revoking_on_one_proposal_does_not_disturb_another() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 4);
    let proposer = signers.get(0).unwrap();

    let id_a = bridge.propose_multisig_action(&proposer, &sample_action(&env));
    let id_b = bridge.propose_multisig_action(&proposer, &sample_action(&env));
    assert_ne!(id_a, id_b, "each proposal must get a distinct id");

    let approver = signers.get(1).unwrap();
    bridge.approve_multisig_action(&approver, &id_a);
    bridge.approve_multisig_action(&approver, &id_b);

    let untouched_before = bridge.get_multisig_proposal(&id_b).unwrap();

    bridge.revoke_multisig_approval(&approver, &id_a);

    let untouched_after = bridge.get_multisig_proposal(&id_b).unwrap();
    assert_eq!(
        untouched_before, untouched_after,
        "revoking on proposal A must leave proposal B untouched"
    );
    assert!(
        untouched_after.approvals.contains(&approver),
        "the same signer's approval on another proposal must survive"
    );
}

// ── Property-based coverage of the input space ───────────────────────────────

proptest! {
    /// For any signer set size and any signer index, approve-then-revoke is a
    /// round trip that restores the proposal exactly.
    #[test]
    fn approve_then_revoke_round_trips_for_any_signer(
        signer_count in 2u32..6,
        approver_idx in 1u32..6,
    ) {
        prop_assume!(approver_idx < signer_count);

        let env = Env::default();
        env.mock_all_auths();

        // threshold == signer_count keeps the proposal un-executable mid-test.
        let (bridge, signers) = setup_multisig(&env, signer_count, signer_count);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let baseline = bridge.get_multisig_proposal(&id).unwrap();
        let approver = signers.get(approver_idx).unwrap();

        bridge.approve_multisig_action(&approver, &id);
        bridge.revoke_multisig_approval(&approver, &id);

        let restored = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert_eq!(baseline, restored);
    }

    /// Revoking always shrinks the approval list by exactly one and never
    /// touches the immutable fields.
    #[test]
    fn revoke_shrinks_by_exactly_one(
        signer_count in 3u32..6,
        approver_idx in 1u32..6,
    ) {
        prop_assume!(approver_idx < signer_count);

        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, signer_count, signer_count);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let approver = signers.get(approver_idx).unwrap();
        bridge.approve_multisig_action(&approver, &id);

        let before = bridge.get_multisig_proposal(&id).unwrap();
        bridge.revoke_multisig_approval(&approver, &id);
        let after = bridge.get_multisig_proposal(&id).unwrap();

        prop_assert_eq!(after.approvals.len(), before.approvals.len() - 1);
        prop_assert!(!after.approvals.contains(&approver));
        prop_assert!(approvals_are_unique(&after));
        prop_assert_eq!(immutable_parts(&before), immutable_parts(&after));
    }

    /// Revoking an id that was never allocated always fails with
    /// `ProposalNotFound` and writes nothing.
    #[test]
    fn revoking_unallocated_id_always_rejected(id in 1u64..u64::MAX) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 2);
        let signer = signers.get(0).unwrap();

        let allocated = bridge.propose_multisig_action(&signer, &sample_action(&env));
        prop_assume!(id != allocated);

        let result = bridge.try_revoke_multisig_approval(&signer, &id);
        prop_assert_eq!(result, Err(Ok(Error::ProposalNotFound)));
        prop_assert!(bridge.get_multisig_proposal(&id).is_none());
    }

    /// Repeated revocation attempts after the first success never drive the
    /// approval count below zero or otherwise mutate the proposal.
    #[test]
    fn repeated_revoke_never_underflows(extra_attempts in 1u32..5) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 3);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let approver = signers.get(1).unwrap();
        bridge.approve_multisig_action(&approver, &id);
        bridge.revoke_multisig_approval(&approver, &id);
        let settled = bridge.get_multisig_proposal(&id).unwrap();

        for _ in 0..extra_attempts {
            let result = bridge.try_revoke_multisig_approval(&approver, &id);
            prop_assert_eq!(result, Err(Ok(Error::SignerNotFound)));
        }

        let after = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert!(approvals_are_unique(&after));
        prop_assert_eq!(settled, after);
    }

    /// An arbitrary outsider is always rejected and never mutates the proposal.
    #[test]
    fn arbitrary_outsider_revoke_always_rejected(outsider_count in 1u32..4) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 2);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let before = bridge.get_multisig_proposal(&id).unwrap();

        for _ in 0..outsider_count {
            let outsider = Address::generate(&env);
            let result = bridge.try_revoke_multisig_approval(&outsider, &id);
            prop_assert_eq!(result, Err(Ok(Error::SignerNotFound)));
        }

        let after = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert_eq!(before, after);
    }
}
