extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::StellarAssetClient,
    vec, Address, Env,
};

fn setup_bridge<'a>(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'a>,
    Address,
    Address,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_sac = StellarAssetClient::new(env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000_000, &1, &signers, &1, &0);

    (contract_id, bridge, admin, token_addr, token_sac)
}

#[test]
fn test_trigger_emergency_recovery_too_early_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, token_sac) = setup_bridge(&env);
    let recovery = Address::generate(&env);

    // Fund the contract
    token_sac.mint(&bridge.address, &10_000);

    // Set emergency recovery
    bridge.set_emergency_recovery(&recovery, &5_000);

    // Immediate trigger must fail because inactivity threshold has not elapsed
    let result = bridge.try_trigger_emergency_recovery();
    assert_eq!(result, Err(Ok(Error::InactivityThresholdNotReached)));
}

#[test]
fn test_trigger_emergency_recovery_after_threshold_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, token_sac) = setup_bridge(&env);
    let recovery = Address::generate(&env);

    // Fund the contract
    token_sac.mint(&bridge.address, &10_000);

    // Set emergency recovery with cap of 4,000
    bridge.set_emergency_recovery(&recovery, &4_000);

    // Set inactivity threshold to minimum
    bridge.set_inactivity_threshold(&MIN_INACTIVITY_THRESHOLD);

    let last_admin_ledger = bridge.get_last_admin_action_ledger();
    let target_ledger = last_admin_ledger + MIN_INACTIVITY_THRESHOLD + 1;
    env.ledger().set_sequence_number(target_ledger);

    // Now trigger emergency recovery
    bridge.trigger_emergency_recovery();

    // Verify event was emitted (events().all() drains the buffer)
    let events = env.events().all();
    let raw = events.events();
    assert!(!raw.is_empty());

    // Verify recovery received cap amount
    let recovery_balance = token_sac.balance(&recovery);
    assert_eq!(recovery_balance, 4_000);

    // Verify contract balance decreased
    let contract_balance = token_sac.balance(&bridge.address);
    assert_eq!(contract_balance, 6_000);
}

#[test]
fn test_trigger_emergency_recovery_respects_cap_when_balance_is_lower() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, token_sac) = setup_bridge(&env);
    let recovery = Address::generate(&env);

    // Contract only has 1,500 tokens
    token_sac.mint(&bridge.address, &1_500);

    // Recovery cap is 5,000 (higher than contract balance)
    bridge.set_emergency_recovery(&recovery, &5_000);
    bridge.set_inactivity_threshold(&1_000);

    let last_admin = bridge.get_last_admin_action_ledger();
    env.ledger().set_sequence_number(last_admin + 1_000 + 10);

    // Trigger recovery
    bridge.trigger_emergency_recovery();

    // Recovery address should receive all available balance (1,500), not exceeding cap
    let recovery_balance = token_sac.balance(&recovery);
    assert_eq!(recovery_balance, 1_500);

    let contract_balance = token_sac.balance(&bridge.address);
    assert_eq!(contract_balance, 0);
}

#[test]
fn test_trigger_emergency_recovery_without_address_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, token_sac) = setup_bridge(&env);
    token_sac.mint(&bridge.address, &10_000);

    // Inactivity threshold passes without setting recovery address
    let last_admin = bridge.get_last_admin_action_ledger();
    env.ledger().set_sequence_number(last_admin + DEFAULT_INACTIVITY_THRESHOLD + 1);

    let result = bridge.try_trigger_emergency_recovery();
    assert_eq!(result, Err(Ok(Error::NoEmergencyRecoveryAddress)));
}

#[test]
fn test_admin_action_resets_inactivity_timer() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, token_sac) = setup_bridge(&env);
    let recovery = Address::generate(&env);

    token_sac.mint(&bridge.address, &10_000);
    bridge.set_emergency_recovery(&recovery, &5_000);
    bridge.set_inactivity_threshold(&1_000);

    let initial_admin_ledger = bridge.get_last_admin_action_ledger();

    // Advance ledger almost to threshold
    env.ledger().set_sequence_number(initial_admin_ledger + 1_000 - 10);

    // Admin performs an action (e.g., set_cooldown)
    bridge.set_cooldown(&100);

    let updated_admin_ledger = bridge.get_last_admin_action_ledger();
    assert_eq!(updated_admin_ledger, initial_admin_ledger + 1_000 - 10);

    // Advancing 5 ledgers from update is past original threshold, but NOT past updated threshold
    env.ledger().set_sequence_number(updated_admin_ledger + 5);

    let result = bridge.try_trigger_emergency_recovery();
    assert_eq!(result, Err(Ok(Error::InactivityThresholdNotReached)));

    // Advancing past the NEW threshold succeeds
    env.ledger().set_sequence_number(updated_admin_ledger + 1_000 + 1);
    let result_success = bridge.try_trigger_emergency_recovery();
    assert_eq!(result_success, Ok(Ok(())));
}

#[test]
fn test_set_inactivity_threshold_bounds() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, _token_sac) = setup_bridge(&env);

    // Below minimum (1_000)
    let res_low = bridge.try_set_inactivity_threshold(&(MIN_INACTIVITY_THRESHOLD - 1));
    assert_eq!(res_low, Err(Ok(Error::InvalidAmount)));

    // Above maximum (10_000_000)
    let res_high = bridge.try_set_inactivity_threshold(&(MAX_INACTIVITY_THRESHOLD + 1));
    assert_eq!(res_high, Err(Ok(Error::InvalidAmount)));

    // Valid threshold
    let res_valid = bridge.try_set_inactivity_threshold(&50_000);
    assert_eq!(res_valid, Ok(Ok(())));
    assert_eq!(bridge.get_inactivity_threshold(), 50_000);
}

#[test]
fn test_trigger_emergency_recovery_denied_address_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, _token_addr, token_sac) = setup_bridge(&env);
    let recovery = Address::generate(&env);

    token_sac.mint(&bridge.address, &10_000);
    bridge.set_emergency_recovery(&recovery, &5_000);
    bridge.set_inactivity_threshold(&MIN_INACTIVITY_THRESHOLD);

    // Deny recovery address
    bridge.deny_address(&recovery);

    let last_admin = bridge.get_last_admin_action_ledger();
    env.ledger().set_sequence_number(last_admin + MIN_INACTIVITY_THRESHOLD + 1);

    let result = bridge.try_trigger_emergency_recovery();
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
}
