#![cfg(test)]
use crate::{DataKey, Error, FiatBridge, FiatBridgeClient, UpgradeProposal, UpgradeProposalTiming};
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, BytesN, Env, IntoVal};

#[test]
fn test_migrate_upgrade_proposal_timing_no_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let token = Address::generate(&env);
    bridge.init(
        &admin,
        &token,
        &1_000,
        &100,
        &soroban_sdk::vec![&env, admin.clone()],
        &1,
        &0,
    );

    assert_eq!(bridge.try_migrate_upgrade_proposal_timing(), Ok(Ok(())));

    let timing_exists: bool = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .has(&DataKey::UpgradeProposalTiming)
    });
    assert!(!timing_exists);
}

#[test]
fn test_migrate_upgrade_proposal_timing_legacy_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let token = Address::generate(&env);
    bridge.init(
        &admin,
        &token,
        &1_000,
        &100,
        &soroban_sdk::vec![&env, admin.clone()],
        &1,
        &0,
    );

    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    let executable_after = 200_000;

    env.as_contract(&contract_id, || {
        let proposal = UpgradeProposal {
            wasm_hash: wasm_hash.clone(),
            executable_after,
            new_version: 1,
        };
        env.storage()
            .instance()
            .set(&DataKey::UpgradeProposal, &proposal);
    });

    assert_eq!(bridge.try_migrate_upgrade_proposal_timing(), Ok(Ok(())));

    let timing = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get::<_, UpgradeProposalTiming>(&DataKey::UpgradeProposalTiming)
            .unwrap()
    });

    assert_eq!(timing.wasm_hash, wasm_hash);
    assert_eq!(timing.executable_after, executable_after);
    assert_eq!(timing.delay, 120960);
    assert_eq!(timing.proposed_at, executable_after.saturating_sub(120960));

    env.ledger().with_mut(|li| {
        li.sequence_number = executable_after + 1;
    });

    assert_eq!(bridge.try_execute_upgrade(), Ok(Ok(())));
}

#[test]
fn test_migrate_upgrade_proposal_timing_already_present() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let token = Address::generate(&env);
    bridge.init(
        &admin,
        &token,
        &1_000,
        &100,
        &soroban_sdk::vec![&env, admin.clone()],
        &1,
        &0,
    );

    let wasm_hash = BytesN::from_array(&env, &[2u8; 32]);

    env.ledger().with_mut(|li| {
        li.sequence_number = 100_000;
    });
    bridge.propose_upgrade(&wasm_hash, &2u32);

    let original_timing = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get::<_, UpgradeProposalTiming>(&DataKey::UpgradeProposalTiming)
            .unwrap()
    });

    assert_eq!(bridge.try_migrate_upgrade_proposal_timing(), Ok(Ok(())));

    let after_timing = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get::<_, UpgradeProposalTiming>(&DataKey::UpgradeProposalTiming)
            .unwrap()
    });

    assert_eq!(original_timing, after_timing);
}

#[test]
fn test_withdraw_operator_auth_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let token = Address::generate(&env);
    bridge.init(
        &admin,
        &token,
        &1_000,
        &100,
        &soroban_sdk::vec![&env, admin.clone()],
        &1,
        &0,
    );

    let operator1 = Address::generate(&env);
    let operator2 = Address::generate(&env);
    let recipient = Address::generate(&env);
    let amount = 50;

    bridge.set_withdraw_operator(&operator1);

    let admin_res = bridge.try_withdraw(&admin, &recipient, &amount, &token);
    assert_ne!(admin_res, Err(Ok(Error::Unauthorized)));

    let op1_res = bridge.try_withdraw(&operator1, &recipient, &amount, &token);
    assert_ne!(op1_res, Err(Ok(Error::Unauthorized)));

    bridge.set_withdraw_operator(&operator2);

    let op1_res_after = bridge.try_withdraw(&operator1, &recipient, &amount, &token);
    assert_eq!(op1_res_after, Err(Ok(Error::Unauthorized)));

    let op2_res = bridge.try_withdraw(&operator2, &recipient, &amount, &token);
    assert_ne!(op2_res, Err(Ok(Error::Unauthorized)));

    bridge.remove_withdraw_operator();

    let op2_res_after = bridge.try_withdraw(&operator2, &recipient, &amount, &token);
    assert_eq!(op2_res_after, Err(Ok(Error::Unauthorized)));

    let admin_res_after = bridge.try_withdraw(&admin, &recipient, &amount, &token);
    assert_ne!(admin_res_after, Err(Ok(Error::Unauthorized)));
}
