//! Invariant tests for [`FiatBridge::propose_multisig_action`].
//!
//! The proposal is an accounting-neutral governance record: a valid signer
//! creates exactly one auto-approved proposal, while failed calls leave both
//! the proposal counter and all existing proposals untouched.

use crate::{BatchAdminOp, Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, Env, Symbol, Vec};

fn setup(env: &Env, signer_count: u32) -> (FiatBridgeClient<'_>, Vec<Address>) {
    let admin = Address::generate(env);
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }
    bridge.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);
    (bridge, signers)
}

fn action(env: &Env, payload: &[u8]) -> BatchAdminOp {
    BatchAdminOp {
        op_type: Symbol::new(env, "pause"),
        payload: Bytes::from_slice(env, payload),
    }
}

fn accounting(bridge: &FiatBridgeClient) -> (i128, i128, i128, i128) {
    (
        bridge.get_limit(),
        bridge.get_total_deposited(),
        bridge.get_total_withdrawn(),
        bridge.get_total_liabilities(),
    )
}

proptest! {
    #[test]
    fn valid_signer_creates_exactly_one_auto_approved_proposal(payload in proptest::collection::vec(any::<u8>(), 0..64)) {
        let env = Env::default();
        env.mock_all_auths();
        let (bridge, signers) = setup(&env, 3);
        let proposer = signers.get(1).unwrap();
        let before = accounting(&bridge);

        let id = bridge.propose_multisig_action(&proposer, &action(&env, &payload));
        let proposal = bridge.get_multisig_proposal(&id).unwrap();

        prop_assert_eq!(id, 0);
        prop_assert_eq!(proposal.creator, proposer.clone());
        prop_assert_eq!(proposal.action, action(&env, &payload));
        prop_assert_eq!(proposal.approvals.len(), 1);
        prop_assert_eq!(proposal.approvals.get(0).unwrap(), proposer);
        prop_assert!(!proposal.executed);
        prop_assert_eq!(accounting(&bridge), before);
    }
}

#[test]
fn sequential_proposals_have_monotonic_ids_without_touching_prior_state() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, signers) = setup(&env, 2);
    let proposer = signers.get(0).unwrap();
    let first = bridge.propose_multisig_action(&proposer, &action(&env, b"one"));
    let snapshot = bridge.get_multisig_proposal(&first).unwrap();
    let second = bridge.propose_multisig_action(&proposer, &action(&env, b"two"));

    assert_eq!(first, 0);
    assert_eq!(second, 1);
    assert_eq!(bridge.get_multisig_proposal(&first), Some(snapshot));
}

#[test]
fn unauthorised_proposer_is_rejected_without_allocating_an_id() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, signers) = setup(&env, 2);
    let signer = signers.get(0).unwrap();
    let outsider = Address::generate(&env);
    let before = accounting(&bridge);

    assert_eq!(
        bridge.try_propose_multisig_action(&outsider, &action(&env, b"no")),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(accounting(&bridge), before);
    assert!(bridge.get_multisig_proposal(&0).is_none());
    assert_eq!(
        bridge.propose_multisig_action(&signer, &action(&env, b"yes")),
        0
    );
}
