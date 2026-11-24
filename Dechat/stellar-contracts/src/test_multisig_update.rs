extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    vec, Address, Bytes, Env, Symbol, Vec,
};

fn setup_bridge<'a>(
    env: &Env,
    signers: &Vec<Address>,
    threshold: u32,
) -> (Address, FiatBridgeClient<'a>, Address, Address) {
    let admin = signers.get(0).unwrap();
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    bridge.init(&admin, &token_addr, &1_000_000_000, &1, signers, &threshold, &0);

    (contract_id, bridge, admin, token_addr)
}

#[test]
fn test_multisig_rotation_and_threshold_change_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let initial_signers = vec![&env, s1.clone(), s2.clone(), s3.clone()];

    let (_contract_id, bridge, _admin, _token_addr) = setup_bridge(&env, &initial_signers, 2);

    assert_eq!(bridge.get_multisig_threshold(), 2);
    assert_eq!(bridge.get_multisig_signers().len(), 3);

    // New signers: s1, s4, s5 with threshold 3
    let s4 = Address::generate(&env);
    let s5 = Address::generate(&env);
    let new_signers = vec![&env, s1.clone(), s4.clone(), s5.clone()];

    let op = FiatBridge::build_update_multisig_op(&env, new_signers.clone(), 3);
    let prop_id = bridge.propose_multisig_action(&s1, &op);

    // s2 approves
    bridge.approve_multisig_action(&s2, &prop_id);

    // Execute proposal
    bridge.execute_multisig_action(&prop_id);

    // Verify rotation and threshold update
    assert_eq!(bridge.get_multisig_threshold(), 3);
    let current_signers = bridge.get_multisig_signers();
    assert_eq!(current_signers.len(), 3);
    assert!(current_signers.contains(&s1));
    assert!(current_signers.contains(&s4));
    assert!(current_signers.contains(&s5));
    assert!(!current_signers.contains(&s2));
    assert!(!current_signers.contains(&s3));

    // s4 (new signer) can propose an action
    let cool_op = BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: Bytes::from_slice(&env, &42u32.to_be_bytes()),
    };
    let new_prop_id = bridge.propose_multisig_action(&s4, &cool_op);

    // s2 (old removed signer) cannot approve
    assert_eq!(
        bridge.try_approve_multisig_action(&s2, &new_prop_id),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_multisig_approval_recount_on_signer_removal() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let initial_signers = vec![&env, s1.clone(), s2.clone(), s3.clone()];

    let (_contract_id, bridge, _admin, _token_addr) = setup_bridge(&env, &initial_signers, 2);

    // Proposal 1: set_cooldown to 99, proposed by s2, approved by s3
    let cool_op = BatchAdminOp {
        op_type: Symbol::new(&env, "set_cooldown"),
        payload: Bytes::from_slice(&env, &99u32.to_be_bytes()),
    };
    let prop1 = bridge.propose_multisig_action(&s2, &cool_op);
    bridge.approve_multisig_action(&s3, &prop1);

    // Proposal 1 now has 2 approvals (s2 and s3).
    // Before executing Proposal 1, propose and execute rotation: remove s2 and s3!
    let s4 = Address::generate(&env);
    let s5 = Address::generate(&env);
    let new_signers = vec![&env, s1.clone(), s4.clone(), s5.clone()];

    let rot_op = FiatBridge::build_update_multisig_op(&env, new_signers, 2);
    let prop2 = bridge.propose_multisig_action(&s1, &rot_op);
    bridge.approve_multisig_action(&s2, &prop2);
    bridge.execute_multisig_action(&prop2);

    // Active signers are now [s1, s4, s5]
    // Attempt to execute Proposal 1: approvals were s2 and s3, neither is in active signers!
    let exec_res = bridge.try_execute_multisig_action(&prop1);
    assert_eq!(exec_res, Err(Ok(Error::ThresholdNotMet)));

    // Active signers s4 and s5 approve Proposal 1
    bridge.approve_multisig_action(&s4, &prop1);
    bridge.approve_multisig_action(&s5, &prop1);

    // Now Proposal 1 execution succeeds
    bridge.execute_multisig_action(&prop1);
    assert_eq!(bridge.get_cooldown(), 99);
}

#[test]
fn test_update_multisig_direct_call_forbidden() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = Address::generate(&env);
    let initial_signers = vec![&env, s1.clone()];
    let (_contract_id, bridge, _admin, _token_addr) = setup_bridge(&env, &initial_signers, 1);

    // Direct invocation must be rejected with Unauthorized
    let res = bridge.try_update_multisig(&initial_signers, &1);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));

    // Batch admin invocation must also be rejected
    let rot_op = FiatBridge::build_update_multisig_op(&env, initial_signers, 1);
    let ops = vec![&env, rot_op];
    let batch_res = bridge.execute_batch_admin(&ops);
    assert_eq!(batch_res.failure_count, 1);
    assert_eq!(batch_res.success_count, 0);
}

#[test]
fn test_update_multisig_invalid_configurations() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let initial_signers = vec![&env, s1.clone(), s2.clone()];
    let (_contract_id, bridge, _admin, _token_addr) = setup_bridge(&env, &initial_signers, 1);

    // 1. Empty signers -> InvalidThreshold
    let empty_signers = Vec::<Address>::new(&env);
    let op_empty = FiatBridge::build_update_multisig_op(&env, empty_signers, 1);
    let prop_empty = bridge.propose_multisig_action(&s1, &op_empty);
    assert_eq!(bridge.try_execute_multisig_action(&prop_empty), Err(Ok(Error::InvalidThreshold)));

    // 2. Threshold 0 -> InvalidThreshold
    let op_zero_thresh = FiatBridge::build_update_multisig_op(&env, initial_signers.clone(), 0);
    let prop_zero = bridge.propose_multisig_action(&s1, &op_zero_thresh);
    assert_eq!(bridge.try_execute_multisig_action(&prop_zero), Err(Ok(Error::InvalidThreshold)));

    // 3. Threshold > signers.len() -> InvalidThreshold
    let op_high_thresh = FiatBridge::build_update_multisig_op(&env, initial_signers.clone(), 5);
    let prop_high = bridge.propose_multisig_action(&s1, &op_high_thresh);
    assert_eq!(bridge.try_execute_multisig_action(&prop_high), Err(Ok(Error::InvalidThreshold)));

    // 4. Duplicate signers -> DuplicateSigner
    let dup_signers = vec![&env, s1.clone(), s1.clone()];
    let op_dup = FiatBridge::build_update_multisig_op(&env, dup_signers, 1);
    let prop_dup = bridge.propose_multisig_action(&s1, &op_dup);
    assert_eq!(bridge.try_execute_multisig_action(&prop_dup), Err(Ok(Error::DuplicateSigner)));

    // 5. Exceed MAX_SIGNERS (20)
    let mut too_many = Vec::new(&env);
    for _ in 0..21 {
        too_many.push_back(Address::generate(&env));
    }
    let op_too_many = FiatBridge::build_update_multisig_op(&env, too_many, 1);
    let prop_too_many = bridge.propose_multisig_action(&s1, &op_too_many);
    assert_eq!(bridge.try_execute_multisig_action(&prop_too_many), Err(Ok(Error::MaxSignersReached)));
}

#[test]
fn test_batch_set_limit_op() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = Address::generate(&env);
    let initial_signers = vec![&env, s1.clone()];
    let (_contract_id, bridge, _admin, token_addr) = setup_bridge(&env, &initial_signers, 1);

    // Set limit via multisig proposal
    let op = FiatBridge::build_set_limit_op(&env, token_addr.clone(), 555_000_000);
    let prop_id = bridge.propose_multisig_action(&s1, &op);
    bridge.execute_multisig_action(&prop_id);

    assert_eq!(bridge.get_limit(), 555_000_000);

    // Set limit via execute_batch_admin
    let op2 = FiatBridge::build_set_limit_op(&env, token_addr.clone(), 777_000_000);
    let ops = vec![&env, op2];
    let res = bridge.execute_batch_admin(&ops);
    assert_eq!(res.success_count, 1);
    assert_eq!(bridge.get_limit(), 777_000_000);

    // Invalid limit <= 0 fails
    let op_invalid = FiatBridge::build_set_limit_op(&env, token_addr, 0);
    let prop_invalid = bridge.propose_multisig_action(&s1, &op_invalid);
    assert_eq!(bridge.try_execute_multisig_action(&prop_invalid), Err(Ok(Error::ZeroAmount)));
}
