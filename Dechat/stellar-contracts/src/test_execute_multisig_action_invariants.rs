//! Soroban invariant tests for `execute_multisig_action`.
//!
//! `execute_multisig_action` is the terminal step of the multisig flow: it
//! reads a proposal, refuses to run it unless the approval count has reached
//! the configured threshold, applies the encoded admin op, and flips the
//! proposal to `executed`.
//!
//! The invariants exercised here are:
//!
//! * the executed flag is one-way and single-shot (no double execution),
//! * the threshold gate holds for every approval count below the threshold,
//! * every failure path leaves the proposal and the target state untouched,
//! * an unauthorised caller cannot gain approvals or force execution,
//! * accounting totals are unaffected by the governance action itself.
//!
//! The property-based cases use `proptest` over the signer-count / threshold /
//! approval-count space, mirroring `test_deposit_fuzz.rs`.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`. See
//! [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{BatchAdminOp, Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, Env, Symbol, Vec};

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

/// Register and initialise a bridge with `signer_count` distinct signers and
/// the supplied threshold. Returns the client and the signer vector.
fn setup_bridge_with_signers<'a>(
    env: &Env,
    signer_count: u32,
    threshold: u32,
) -> (FiatBridgeClient<'a>, Vec<Address>) {
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

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &threshold, &0);

    (client, signers)
}

/// A `set_cooldown` op, whose effect is observable through `get_cooldown`.
/// The payload is a big-endian u32, matching `bytes_to_u32`.
fn set_cooldown_op(env: &Env, ledgers: u32) -> BatchAdminOp {
    BatchAdminOp {
        op_type: Symbol::new(env, "set_cooldown"),
        payload: Bytes::from_slice(env, &ledgers.to_be_bytes()),
    }
}

/// An op whose `op_type` matches nothing in the dispatcher, so
/// `execute_single_admin_op` returns `InternalError`.
fn unknown_op(env: &Env) -> BatchAdminOp {
    BatchAdminOp {
        op_type: Symbol::new(env, "not_a_real_op"),
        payload: Bytes::from_slice(env, &[0u8; 4]),
    }
}

/// Happy path: once the threshold is met the action applies exactly once and
/// the proposal is marked executed.
#[test]
fn execution_applies_the_action_and_sets_executed_once() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let second = signers.get(1).unwrap();

    let cooldown_before = client.get_cooldown();
    let target = cooldown_before.wrapping_add(42);

    let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, target));
    client.approve_multisig_action(&second, &id);

    client.execute_multisig_action(&id);

    assert_eq!(client.get_cooldown(), target);
    let proposal = client.get_multisig_proposal(&id).unwrap();
    assert!(proposal.executed);
}

/// The executed flag is single-shot: a second execution is rejected and the
/// action is not applied twice.
#[test]
fn double_execution_is_rejected_and_action_is_not_reapplied() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let second = signers.get(1).unwrap();

    let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 77));
    client.approve_multisig_action(&second, &id);
    client.execute_multisig_action(&id);

    assert_eq!(client.get_cooldown(), 77);

    // Move the observable state, then attempt a replay of the same proposal.
    let id2 = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 11));
    client.approve_multisig_action(&second, &id2);
    client.execute_multisig_action(&id2);
    assert_eq!(client.get_cooldown(), 11);

    let replay = client.try_execute_multisig_action(&id);
    assert_eq!(replay, Err(Ok(Error::ProposalAlreadyExecuted)));

    // The replay did not re-apply the first proposal.
    assert_eq!(client.get_cooldown(), 11);
    assert!(client.get_multisig_proposal(&id).unwrap().executed);
}

/// Below the threshold execution must fail, and must leave both the proposal
/// and the target state untouched.
#[test]
fn below_threshold_execution_fails_without_mutating_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 3);
    let proposer = signers.get(0).unwrap();

    let cooldown_before = client.get_cooldown();
    let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 999));

    // Only the proposer has approved, threshold is 3.
    let result = client.try_execute_multisig_action(&id);
    assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));

    let proposal = client.get_multisig_proposal(&id).unwrap();
    assert!(!proposal.executed);
    assert_eq!(proposal.approvals.len(), 1);
    assert_eq!(client.get_cooldown(), cooldown_before);
}

/// A missing proposal id is rejected and creates no state.
#[test]
fn unknown_proposal_id_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _signers) = setup_bridge_with_signers(&env, 3, 2);

    let cooldown_before = client.get_cooldown();

    let result = client.try_execute_multisig_action(&4242);
    assert_eq!(result, Err(Ok(Error::ProposalNotFound)));

    assert!(client.get_multisig_proposal(&4242).is_none());
    assert_eq!(client.get_cooldown(), cooldown_before);
}

/// A failing inner op must not partially mutate storage: the proposal stays
/// unexecuted so that it can be retried or superseded.
#[test]
fn failing_inner_op_does_not_mark_proposal_executed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let second = signers.get(1).unwrap();

    let cooldown_before = client.get_cooldown();

    let id = client.propose_multisig_action(&proposer, &unknown_op(&env));
    client.approve_multisig_action(&second, &id);

    let result = client.try_execute_multisig_action(&id);
    assert_eq!(result, Err(Ok(Error::InternalError)));

    // The executed flag is written only after the op succeeds, so the proposal
    // must still be open and the target state untouched.
    let proposal = client.get_multisig_proposal(&id).unwrap();
    assert!(!proposal.executed);
    assert_eq!(client.get_cooldown(), cooldown_before);
}

/// A non-signer cannot contribute an approval, so it cannot push a proposal
/// over the threshold and cannot cause an execution.
#[test]
fn unauthorised_caller_cannot_reach_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let outsider = Address::generate(&env);

    let cooldown_before = client.get_cooldown();
    let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 555));

    let approve = client.try_approve_multisig_action(&outsider, &id);
    assert_eq!(approve, Err(Ok(Error::Unauthorized)));

    // The rejected approval left no trace.
    let proposal = client.get_multisig_proposal(&id).unwrap();
    assert_eq!(proposal.approvals.len(), 1);
    assert!(!proposal.approvals.contains(&outsider));

    // And execution is still gated.
    let result = client.try_execute_multisig_action(&id);
    assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));
    assert!(!client.get_multisig_proposal(&id).unwrap().executed);
    assert_eq!(client.get_cooldown(), cooldown_before);
}

/// A non-signer cannot open a proposal at all.
#[test]
fn unauthorised_caller_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _signers) = setup_bridge_with_signers(&env, 3, 2);
    let outsider = Address::generate(&env);

    let result = client.try_propose_multisig_action(&outsider, &set_cooldown_op(&env, 5));
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

/// The governance action itself moves no funds: deposit / withdrawal totals are
/// identical before and after a successful execution.
#[test]
fn accounting_totals_are_unchanged_by_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let second = signers.get(1).unwrap();

    let deposited_before = client.get_total_deposited();
    let withdrawn_before = client.get_total_withdrawn();
    let liabilities_before = client.get_total_liabilities();

    let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 123));
    client.approve_multisig_action(&second, &id);
    client.execute_multisig_action(&id);

    assert_eq!(client.get_total_deposited(), deposited_before);
    assert_eq!(client.get_total_withdrawn(), withdrawn_before);
    assert_eq!(client.get_total_liabilities(), liabilities_before);
}

/// Revoking an approval back below the threshold re-closes the execution gate.
#[test]
fn revoked_approval_recloses_the_threshold_gate() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signers) = setup_bridge_with_signers(&env, 3, 2);
    let proposer = signers.get(0).unwrap();
    let second = signers.get(1).unwrap();

    let cooldown_before = client.get_cooldown();
    let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 321));
    client.approve_multisig_action(&second, &id);

    client.revoke_multisig_approval(&second, &id);

    let result = client.try_execute_multisig_action(&id);
    assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));
    assert!(!client.get_multisig_proposal(&id).unwrap().executed);
    assert_eq!(client.get_cooldown(), cooldown_before);
}

proptest! {
    /// For every approval count strictly below the threshold, execution is
    /// refused and neither the proposal nor the target state moves.
    #[test]
    fn execution_is_gated_for_every_sub_threshold_approval_count(
        signer_count in 2u32..=6u32,
        extra_seed in 0u32..6u32,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        // Threshold is the full signer set, so any strict subset is sub-threshold.
        let threshold = signer_count;
        let (client, signers) = setup_bridge_with_signers(&env, signer_count, threshold);

        let proposer = signers.get(0).unwrap();
        let cooldown_before = client.get_cooldown();
        let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, 250));

        // Add approvals from distinct signers, always stopping one short.
        let extra = extra_seed % (signer_count - 1);
        for i in 1..=extra {
            client.approve_multisig_action(&signers.get(i).unwrap(), &id);
        }

        let approvals = client.get_multisig_proposal(&id).unwrap().approvals.len();
        prop_assert!(approvals < threshold);

        let result = client.try_execute_multisig_action(&id);
        prop_assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));
        prop_assert!(!client.get_multisig_proposal(&id).unwrap().executed);
        prop_assert_eq!(client.get_cooldown(), cooldown_before);
    }

    /// Whenever the approval count reaches the threshold, execution succeeds,
    /// applies the payload exactly, and is not repeatable.
    #[test]
    fn execution_succeeds_exactly_once_at_threshold(
        signer_count in 1u32..=6u32,
        threshold_seed in 0u32..6u32,
        cooldown in 0u32..100_000u32,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let threshold = (threshold_seed % signer_count) + 1;
        let (client, signers) = setup_bridge_with_signers(&env, signer_count, threshold);

        let proposer = signers.get(0).unwrap();
        let id = client.propose_multisig_action(&proposer, &set_cooldown_op(&env, cooldown));

        // The proposer auto-approves, so top up to exactly the threshold.
        for i in 1..threshold {
            client.approve_multisig_action(&signers.get(i).unwrap(), &id);
        }

        let approvals = client.get_multisig_proposal(&id).unwrap().approvals.len();
        prop_assert_eq!(approvals, threshold);

        client.execute_multisig_action(&id);

        prop_assert_eq!(client.get_cooldown(), cooldown);
        prop_assert!(client.get_multisig_proposal(&id).unwrap().executed);

        // Single-shot: the replay is refused.
        let replay = client.try_execute_multisig_action(&id);
        prop_assert_eq!(replay, Err(Ok(Error::ProposalAlreadyExecuted)));
        prop_assert_eq!(client.get_cooldown(), cooldown);
    }

    /// No id outside the set of created proposals is ever executable.
    #[test]
    fn unknown_ids_are_never_executable(id in 1u64..10_000u64) {
        let env = Env::default();
        env.mock_all_auths();

        let (client, _signers) = setup_bridge_with_signers(&env, 3, 2);
        let cooldown_before = client.get_cooldown();

        // No proposal has been created, so every id is unknown.
        let result = client.try_execute_multisig_action(&id);
        prop_assert_eq!(result, Err(Ok(Error::ProposalNotFound)));
        prop_assert_eq!(client.get_cooldown(), cooldown_before);
    }
}
