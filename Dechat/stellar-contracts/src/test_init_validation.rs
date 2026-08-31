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
    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1, &0);

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
    let result = bridge.try_init(&new_admin, &token, &1_000_000, &1, &signers, &1, &0);

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
    let result = bridge.try_init(&contract_id, &token, &1_000_000, &1, &signers, &1, &0);

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

    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1, &0);

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
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1, &0);

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

    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &0, &0);

    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

// ── Issue #1145: edge case validation regression tests ─────────────────

#[test]
fn test_init_rejects_zero_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let result = bridge.try_init(&admin, &token, &0, &1, &signers, &1, &0);

    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_init_rejects_negative_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let result = bridge.try_init(&admin, &token, &-1, &1, &signers, &1, &0);

    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_init_rejects_i128_max_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let result = bridge.try_init(&admin, &token, &i128::MAX, &1, &signers, &1, &0);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_init_rejects_i128_max_min_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let result = bridge.try_init(&admin, &token, &1_000_000, &i128::MAX, &signers, &1, &0);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_init_rejects_self_referential_admin_token() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    // Admin and token are the same address
    let result = bridge.try_init(&admin, &admin, &1_000_000, &1, &signers, &1, &0);

    assert_eq!(result, Err(Ok(Error::SelfReferentialAddress)));
}

// ── fence-post tests for threshold boundary ────────────────────────────

#[test]
fn test_init_accepts_threshold_equals_signers_count() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signers = vec![&env, signer1, signer2];

    // threshold 2 equals signers count 2 - should succeed
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &2, &0);

    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_init_rejects_threshold_one_above_signers_count() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signers = vec![&env, signer1, signer2];

    // threshold 3 is one above signers count 2 - fence-post rejection
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &3, &0);

    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_init_accepts_threshold_one_below_signers_count() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let signers = vec![&env, signer1, signer2, signer3];

    // threshold 2 is less than signers count 3 - should succeed
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &2, &0);

    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_init_accepts_threshold_one() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    // threshold 1 with 1 signer - should succeed
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1, &0);

    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_init_accepts_max_signers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    // Create exactly 20 signers (MAX_SIGNERS)
    let mut signers = vec![&env];
    for _ in 0..20 {
        signers.push_back(Address::generate(&env));
    }

    // threshold 20 equals signers count - should succeed
    let result = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &20, &0);

    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_init_accepts_one_below_i128_max_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    // i128::MAX - 1 should be accepted
    let result = bridge.try_init(&admin, &token, &(i128::MAX - 1), &1, &signers, &1, &0);

    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_init_nonce_increments_on_successful_attempt() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let accepted = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1, &0);
    assert_eq!(accepted, Ok(Ok(())));
    assert_eq!(bridge.get_init_nonce(&admin), 1);
}

#[test]
fn test_init_rejects_skipped_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    let skipped = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1, &1);
    assert_eq!(skipped, Err(Ok(Error::InvalidNonce)));
    assert_eq!(bridge.get_init_nonce(&admin), 0);
}

#[test]
fn test_init_replay_with_same_nonce_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1, &0);

    let replay = bridge.try_init(&admin, &token, &1_000_000, &1, &signers, &1, &0);
    assert_eq!(replay, Err(Ok(Error::StaleNonce)));
}
