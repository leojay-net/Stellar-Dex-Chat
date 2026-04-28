#[cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env,
};

#[test]
fn test_reinitialization_blocked_after_renounce() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    // First initialization
    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Renounce admin
    bridge.queue_renounce_admin();
    
    // Advance ledger to satisfy MIN_TIMELOCK_DELAY (34560 ledgers)
    let current_ledger = env.ledger().sequence();
    env.ledger().set_sequence_number(current_ledger + 34560 + 1);
    
    bridge.execute_renounce_admin();

    // Verify admin is removed
    let admin_res = bridge.try_get_admin();
    assert!(admin_res.is_err());

    // Attempting to re-initialize should fail with AlreadyInitialized
    // even though the Admin key is gone, because SchemaVersion remains.
    let new_admin = Address::generate(&env);
    let result = bridge.try_init(&new_admin, &token, &1_000_000, &1, &signers, &1);
    
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_init_rejects_contract_as_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let token = Address::generate(&env);
    let signers = vec![&env, token.clone()];

    // Attempt to set contract itself as admin
    let result = bridge.try_init(&contract_id, &token, &1_000_000, &1, &signers, &1);
    
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_init_rejects_too_many_signers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    
    // Create 21 signers (MAX_SIGNERS is 20)
    let mut signers = vec![&env];
    for _ in 0..21 {
        signers.push_back(Address::generate(&env));
    }

    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1);
    
    assert_eq!(result, Err(Ok(Error::MaxSignersReached)));
}

#[test]
fn test_init_rejects_empty_signers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env];

    // threshold 1 but 0 signers
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1);
    
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_init_rejects_zero_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &0);
    
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}
