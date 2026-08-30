//! Invariant tests for [`FiatBridge::execute_upgrade`].
//!
//! `execute_upgrade` consumes a pending [`UpgradeProposal`] whose time lock has
//! expired, invokes `deployer().update_current_contract_wasm`, removes the
//! proposal from storage, and emits an event. The invariants asserted here are:
//!
//! * executing an upgrade requires an existing proposal; attempting to execute
//!   without one fails with `UpgradeProposalMissing` and writes nothing;
//! * executing before `executable_after` is reached fails with `UpgradeNotReady`
//!   and leaves the proposal intact in storage;
//! * failed upgrade attempts leave core contract accounting untouched.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, Vec,
};

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

fn setup_uninitialised(env: &Env) -> FiatBridgeClient<'_> {
    let contract_id = env.register(FiatBridge, ());
    FiatBridgeClient::new(env, &contract_id)
}

fn hash_of(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn state_fingerprint(bridge: &FiatBridgeClient) -> (i128, i128, i128, Address) {
    (
        bridge.get_limit(),
        bridge.get_total_deposited(),
        bridge.get_total_withdrawn(),
        bridge.get_admin(),
    )
}

#[test]
fn execute_upgrade_without_proposal_fails_with_missing_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    let before = state_fingerprint(&bridge);

    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
    assert_eq!(before, state_fingerprint(&bridge));
}

#[test]
fn execute_upgrade_before_timelock_fails_with_not_ready_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (bridge, _admin) = setup_bridge(&env);
    let hash = hash_of(&env, 0xAA);
    bridge.propose_upgrade(&hash);

    // Sequence has not advanced to proposal.executable_after
    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeNotReady)));

    // Proposal must still be present
    let p = bridge.get_upgrade_proposal().expect("proposal must remain");
    assert_eq!(p.wasm_hash, hash);
}

#[test]
fn execute_upgrade_uninitialised_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge = setup_uninitialised(&env);
    let result = bridge.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::UpgradeProposalMissing)));
}

proptest! {
    #[test]
    fn execute_upgrade_premature_always_leaves_proposal_intact(
        offset in 0u32..MIN_UPGRADE_DELAY
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (bridge, _admin) = setup_bridge(&env);
        let hash = hash_of(&env, 0xBB);
        bridge.propose_upgrade(&hash);

        // Advance ledger partially, but less than MIN_UPGRADE_DELAY
        if offset > 0 {
            env.ledger().with_mut(|l| l.sequence_number += offset);
        }

        let result = bridge.try_execute_upgrade();
        prop_assert_eq!(result, Err(Ok(Error::UpgradeNotReady)));

        let p = bridge.get_upgrade_proposal().unwrap();
        prop_assert_eq!(p.wasm_hash, hash);
    }
}
