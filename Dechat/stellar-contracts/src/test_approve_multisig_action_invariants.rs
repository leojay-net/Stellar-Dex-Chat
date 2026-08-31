//! Invariant tests for [`FiatBridge::approve_multisig_action`].
//!
//! `approve_multisig_action` appends a signer to a proposal's approval list.
//! The invariants asserted here are:
//!
//! * a successful approval appends exactly one entry and changes nothing else
//!   on the proposal (creator, action, `executed`, `created_at` are immutable);
//! * approvals never contain duplicates, so the list length is also the count
//!   of distinct approvers;
//! * every rejected call (non-signer, unknown id, already-approved, already
//!   executed) leaves storage byte-for-byte unchanged;
//! * unrelated proposals are never touched by an approval of another id.
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

/// Everything about a proposal that `approve_multisig_action` must not alter.
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
fn approve_appends_exactly_one_approval_and_preserves_the_rest() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 3);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let before = bridge.get_multisig_proposal(&id).unwrap();
    let approver = signers.get(1).unwrap();

    bridge.approve_multisig_action(&approver, &id);

    let after = bridge.get_multisig_proposal(&id).unwrap();

    assert_eq!(
        after.approvals.len(),
        before.approvals.len() + 1,
        "a successful approval must append exactly one entry"
    );
    assert!(
        after.approvals.contains(&approver),
        "the approving signer must appear in the approvals list"
    );
    assert_eq!(
        immutable_parts(&before),
        immutable_parts(&after),
        "approval must not alter creator/action/executed/created_at"
    );
    assert!(approvals_are_unique(&after));
}

#[test]
fn approvals_accumulate_in_order_without_duplicates() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 5, 5);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    // The proposer is auto-approved, so approving signers 1..5 fills the list.
    for i in 1..signers.len() {
        let signer = signers.get(i).unwrap();
        bridge.approve_multisig_action(&signer, &id);

        let p = bridge.get_multisig_proposal(&id).unwrap();
        assert_eq!(
            p.approvals.len(),
            i + 1,
            "approval count must track the number of distinct approvers"
        );
        assert_eq!(
            p.approvals.get(i).unwrap(),
            signer,
            "approvals must be appended in call order"
        );
        assert!(approvals_are_unique(&p));
    }
}

// ── Rejection paths leave no state change ────────────────────────────────────

#[test]
fn non_signer_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let before = bridge.get_multisig_proposal(&id).unwrap();
    let outsider = Address::generate(&env);

    let result = bridge.try_approve_multisig_action(&outsider, &id);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        before, after,
        "a rejected non-signer approval must not mutate the proposal"
    );
    assert!(
        !after.approvals.contains(&outsider),
        "an unauthorised caller must never land in the approvals list"
    );
}

#[test]
fn unknown_proposal_id_is_rejected_and_creates_nothing() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let signer = signers.get(0).unwrap();

    let missing_id = 424_242u64;
    let result = bridge.try_approve_multisig_action(&signer, &missing_id);
    assert_eq!(result, Err(Ok(Error::ProposalNotFound)));

    assert!(
        bridge.get_multisig_proposal(&missing_id).is_none(),
        "approving an unknown id must not conjure a proposal into storage"
    );
}

#[test]
fn double_approval_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    let approver = signers.get(1).unwrap();
    bridge.approve_multisig_action(&approver, &id);

    let before = bridge.get_multisig_proposal(&id).unwrap();

    let result = bridge.try_approve_multisig_action(&approver, &id);
    assert_eq!(result, Err(Ok(Error::AlreadyApproved)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        before, after,
        "a duplicate approval must be a complete no-op"
    );
    assert!(approvals_are_unique(&after));
}

#[test]
fn proposer_cannot_approve_own_proposal_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    // propose_multisig_action already recorded the proposer's approval.
    let before = bridge.get_multisig_proposal(&id).unwrap();
    assert!(before.approvals.contains(&proposer));

    let result = bridge.try_approve_multisig_action(&proposer, &id);
    assert_eq!(result, Err(Ok(Error::AlreadyApproved)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(before, after);
}

#[test]
fn approval_after_execution_is_rejected_and_leaves_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    // threshold 1 => the proposer's own approval is already enough to execute.
    let (bridge, signers) = setup_multisig(&env, 3, 1);
    let proposer = signers.get(0).unwrap();
    let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

    bridge.execute_multisig_action(&id);

    let before = bridge.get_multisig_proposal(&id).unwrap();
    assert!(before.executed, "proposal should be marked executed");

    let latecomer = signers.get(1).unwrap();
    let result = bridge.try_approve_multisig_action(&latecomer, &id);
    assert_eq!(result, Err(Ok(Error::ProposalAlreadyExecuted)));

    let after = bridge.get_multisig_proposal(&id).unwrap();
    assert_eq!(
        before, after,
        "approving an executed proposal must not mutate it"
    );
    assert!(
        !after.approvals.contains(&latecomer),
        "a late approver must not be recorded"
    );
}

// ── Cross-proposal isolation ─────────────────────────────────────────────────

#[test]
fn approving_one_proposal_does_not_disturb_another() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, signers) = setup_multisig(&env, 4, 3);
    let proposer = signers.get(0).unwrap();

    let id_a = bridge.propose_multisig_action(&proposer, &sample_action(&env));
    let id_b = bridge.propose_multisig_action(&proposer, &sample_action(&env));
    assert_ne!(id_a, id_b, "each proposal must get a distinct id");

    let untouched_before = bridge.get_multisig_proposal(&id_b).unwrap();

    bridge.approve_multisig_action(&signers.get(1).unwrap(), &id_a);

    let untouched_after = bridge.get_multisig_proposal(&id_b).unwrap();
    assert_eq!(
        untouched_before, untouched_after,
        "approving proposal A must leave proposal B untouched"
    );
}

// ── Property-based coverage of the input space ───────────────────────────────

proptest! {
    /// For any signer set size and any signer index, a first-time approval by a
    /// legitimate signer succeeds and grows the approval list by exactly one.
    #[test]
    fn approval_by_any_signer_grows_list_by_one(
        signer_count in 2u32..6,
        approver_idx in 1u32..6,
    ) {
        prop_assume!(approver_idx < signer_count);

        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, signer_count, signer_count);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let before = bridge.get_multisig_proposal(&id).unwrap();
        let approver = signers.get(approver_idx).unwrap();

        bridge.approve_multisig_action(&approver, &id);

        let after = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert_eq!(after.approvals.len(), before.approvals.len() + 1);
        prop_assert!(after.approvals.contains(&approver));
        prop_assert!(approvals_are_unique(&after));
        prop_assert_eq!(immutable_parts(&before), immutable_parts(&after));
    }

    /// No matter which id is probed, approving an id that was never allocated
    /// fails with `ProposalNotFound` and writes nothing.
    #[test]
    fn approving_unallocated_id_always_rejected(id in 1u64..u64::MAX) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 2);
        let signer = signers.get(0).unwrap();

        // Only id 0 is ever allocated below, so any id >= 1 is unknown.
        let proposer = signers.get(0).unwrap();
        let allocated = bridge.propose_multisig_action(&proposer, &sample_action(&env));
        prop_assume!(id != allocated);

        let result = bridge.try_approve_multisig_action(&signer, &id);
        prop_assert_eq!(result, Err(Ok(Error::ProposalNotFound)));
        prop_assert!(bridge.get_multisig_proposal(&id).is_none());
    }

    /// Repeated approvals by the same signer never inflate the approval count
    /// beyond the single legitimate entry.
    #[test]
    fn repeated_approval_never_inflates_count(extra_attempts in 1u32..5) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 3);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let approver = signers.get(1).unwrap();
        bridge.approve_multisig_action(&approver, &id);
        let settled = bridge.get_multisig_proposal(&id).unwrap();

        for _ in 0..extra_attempts {
            let result = bridge.try_approve_multisig_action(&approver, &id);
            prop_assert_eq!(result, Err(Ok(Error::AlreadyApproved)));
        }

        let after = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert!(approvals_are_unique(&after));
        prop_assert_eq!(settled, after);
    }

    /// An arbitrary non-signer is always rejected and never mutates the proposal.
    #[test]
    fn arbitrary_outsider_always_rejected(outsider_count in 1u32..4) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, signers) = setup_multisig(&env, 3, 2);
        let proposer = signers.get(0).unwrap();
        let id = bridge.propose_multisig_action(&proposer, &sample_action(&env));

        let before = bridge.get_multisig_proposal(&id).unwrap();

        for _ in 0..outsider_count {
            let outsider = Address::generate(&env);
            let result = bridge.try_approve_multisig_action(&outsider, &id);
            prop_assert_eq!(result, Err(Ok(Error::Unauthorized)));
        }

        let after = bridge.get_multisig_proposal(&id).unwrap();
        prop_assert_eq!(before, after);
    }
}
