#[cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env,
};

#[test]
fn test_set_migration_cursor_rejects_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject zero cursor
    let result = bridge.try_set_migration_cursor(&0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_migration_cursor_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject negative cursor
    let result = bridge.try_set_migration_cursor(&-1);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_migration_cursor_rejects_i128_max() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject i128::MAX
    let result = bridge.try_set_migration_cursor(&i128::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_migration_cursor_accepts_valid_value() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid cursor value
    bridge.set_migration_cursor(&100);
    assert_eq!(bridge.get_migration_cursor(), 100);
}

#[test]
fn test_set_migration_cursor_fence_post() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: exactly at boundary (1 should be accepted)
    bridge.set_migration_cursor(&1);
    assert_eq!(bridge.get_migration_cursor(), 1);
}

#[test]
fn test_set_oracle_rejects_self_referential_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject setting oracle to admin address
    let result = bridge.try_set_oracle(&admin);
    assert_eq!(result, Err(Ok(Error::SelfReferentialAddress)));
}

#[test]
fn test_set_oracle_rejects_self_referential_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject setting oracle to contract address
    let result = bridge.try_set_oracle(&contract_id);
    assert_eq!(result, Err(Ok(Error::SelfReferentialAddress)));
}

#[test]
fn test_set_oracle_accepts_valid_address() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let oracle = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid oracle address
    bridge.set_oracle(&oracle);
    let config = bridge.get_config_snapshot();
    assert_eq!(config.oracle, Some(oracle));
}

#[test]
fn test_set_anti_sandwich_delay_rejects_u32_max() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject u32::MAX
    let result = bridge.try_set_anti_sandwich_delay(&u32::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_anti_sandwich_delay_accepts_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept zero (disables the protection)
    bridge.set_anti_sandwich_delay(&0);
    assert_eq!(bridge.get_anti_sandwich_delay(), 0);
}

#[test]
fn test_set_anti_sandwich_delay_accepts_valid_value() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid value
    bridge.set_anti_sandwich_delay(&100);
    assert_eq!(bridge.get_anti_sandwich_delay(), 100);
}

#[test]
fn test_set_anti_sandwich_delay_fence_post() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: u32::MAX - 1 should be accepted
    bridge.set_anti_sandwich_delay(&(u32::MAX - 1));
    assert_eq!(bridge.get_anti_sandwich_delay(), u32::MAX - 1);
}

#[test]
fn test_set_slippage_threshold_rejects_u32_max() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject u32::MAX
    let result = bridge.try_set_slippage_threshold(&u32::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_slippage_threshold_rejects_exceeds_10000() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject threshold > 10000 (100%)
    let result = bridge.try_set_slippage_threshold(&10001);
    assert_eq!(result, Err(Ok(Error::SlippageTooHigh)));
}

#[test]
fn test_set_slippage_threshold_accepts_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept zero
    bridge.set_slippage_threshold(&0);
    assert_eq!(bridge.get_slippage_threshold(), 0);
}

#[test]
fn test_set_slippage_threshold_accepts_valid_value() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid value
    bridge.set_slippage_threshold(&500); // 5%
    assert_eq!(bridge.get_slippage_threshold(), 500);
}

#[test]
fn test_set_slippage_threshold_fence_post() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: exactly at boundary (10000 should be accepted)
    bridge.set_slippage_threshold(&10000); // 100%
    assert_eq!(bridge.get_slippage_threshold(), 10000);
}

#[test]
fn test_set_slippage_threshold_fence_post_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: 10001 should be rejected (just over boundary)
    let result = bridge.try_set_slippage_threshold(&10001);
    assert_eq!(result, Err(Ok(Error::SlippageTooHigh)));
}

#[test]
fn test_set_fiat_limit_rejects_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject zero
    let result = bridge.try_set_fiat_limit(&0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_set_fiat_limit_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject negative
    let result = bridge.try_set_fiat_limit(&-1);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_set_fiat_limit_rejects_i128_max() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject i128::MAX
    let result = bridge.try_set_fiat_limit(&i128::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_fiat_limit_accepts_valid_value() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid value
    bridge.set_fiat_limit(&100_000);
    assert_eq!(bridge.get_fiat_limit(), Some(100_000));
}

#[test]
fn test_set_fiat_limit_fence_post() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: i128::MAX - 1 should be accepted
    bridge.set_fiat_limit(&(i128::MAX - 1));
    assert_eq!(bridge.get_fiat_limit(), Some(i128::MAX - 1));
}

#[test]
fn test_set_cooldown_rejects_u32_max() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject u32::MAX
    let result = bridge.try_set_cooldown(&u32::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_cooldown_accepts_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept zero (disables cooldown)
    bridge.set_cooldown(&0);
    assert_eq!(bridge.get_cooldown(), 0);
}

#[test]
fn test_set_cooldown_accepts_valid_value() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid value
    bridge.set_cooldown(&100);
    assert_eq!(bridge.get_cooldown(), 100);
}

#[test]
fn test_set_cooldown_fence_post() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: u32::MAX - 1 should be accepted
    bridge.set_cooldown(&(u32::MAX - 1));
    assert_eq!(bridge.get_cooldown(), u32::MAX - 1);
}

#[test]
fn test_set_withdrawal_cooldown_rejects_u32_max_ledgers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject u32::MAX for ledgers
    let result = bridge.try_set_withdrawal_cooldown(&u32::MAX, &1000);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_withdrawal_cooldown_rejects_negative_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject negative threshold
    let result = bridge.try_set_withdrawal_cooldown(&100, &-1);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_withdrawal_cooldown_rejects_i128_max_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should reject i128::MAX for threshold
    let result = bridge.try_set_withdrawal_cooldown(&100, &i128::MAX);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_set_withdrawal_cooldown_accepts_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept zero (disables the guard)
    bridge.set_withdrawal_cooldown(&0, &0);
    assert_eq!(bridge.get_withdrawal_cooldown_ledgers(), 0);
    assert_eq!(bridge.get_withdrawal_cooldown_threshold(), 0);
}

#[test]
fn test_set_withdrawal_cooldown_accepts_valid_values() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Should accept valid values
    bridge.set_withdrawal_cooldown(&100, &5000);
    assert_eq!(bridge.get_withdrawal_cooldown_ledgers(), 100);
    assert_eq!(bridge.get_withdrawal_cooldown_threshold(), 5000);
}

#[test]
fn test_set_withdrawal_cooldown_fence_post_ledgers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: u32::MAX - 1 should be accepted for ledgers
    bridge.set_withdrawal_cooldown(&(u32::MAX - 1), &1000);
    assert_eq!(bridge.get_withdrawal_cooldown_ledgers(), u32::MAX - 1);
}

#[test]
fn test_set_withdrawal_cooldown_fence_post_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signers = vec![&env, admin.clone()];

    bridge.init(&admin, &token, &1_000_000, &1, &signers, &1);

    // Test fence post: i128::MAX - 1 should be accepted for threshold
    bridge.set_withdrawal_cooldown(&100, &(i128::MAX - 1));
    assert_eq!(bridge.get_withdrawal_cooldown_threshold(), i128::MAX - 1);
}
