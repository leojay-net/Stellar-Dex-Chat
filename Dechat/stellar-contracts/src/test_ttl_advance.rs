extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, Env,
};

fn setup_bridge<'a>(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'a>,
    Address,
    Address,
    TokenClient<'a>,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token = TokenClient::new(env, &token_addr);
    let token_sac = StellarAssetClient::new(env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000_000, &1, &signers, &1, &0);

    (contract_id, bridge, admin, token_addr, token, token_sac)
}

#[test]
fn test_ttl_advance_token_registry() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    token_sac.mint(&user, &100_000);

    // Advance ledger significantly (100,000 ledgers)
    env.ledger().set_sequence_number(100_000);

    // Deposit should refresh TokenRegistry TTL and succeed
    bridge.deposit(&user, &10_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 10_000);

    // Advance another 150,000 ledgers (total 250,000)
    env.ledger().set_sequence_number(250_000);

    // Admin updates limit - should refresh TokenRegistry TTL and succeed
    bridge.set_limit(&token_addr, &2_000_000_000, &0);
    assert_eq!(bridge.get_limit(), 2_000_000_000);

    // Advance another 100,000 ledgers (total 350,000)
    env.ledger().set_sequence_number(350_000);

    // Second deposit should work smoothly
    bridge.deposit(&user, &20_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(bridge.get_total_deposited(), 30_000);
}

#[test]
fn test_ttl_advance_withdraw_queue() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);

    token_sac.mint(&user, &100_000);
    bridge.deposit(&user, &50_000, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Queue withdrawal at ledger 100
    env.ledger().set_sequence_number(100);
    let req_id = bridge.request_withdrawal(&user, &30_000, &token_addr, &None, &0);

    // Advance sequence past lock period (e.g. 50,000 ledgers)
    env.ledger().set_sequence_number(50_100);

    // get_withdrawal_request extends TTL on read
    let req = bridge.get_withdrawal_request(&req_id).expect("request should exist");
    assert_eq!(req.amount, 30_000);
    assert_eq!(req.to, user);

    // Execute withdrawal - updates queue, liability, and extends TTL
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &0);

    assert_eq!(token_sac.balance(&user), 80_000);
    assert_eq!(bridge.get_wq_depth(), 0);
}

#[test]
fn test_ttl_advance_denylist() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env);
    let bad_actor = Address::generate(&env);

    // Deny address at ledger 50
    env.ledger().set_sequence_number(50);
    bridge.deny_address(&bad_actor);
    assert!(bridge.is_denied(&bad_actor));

    // Advance 120,000 ledgers
    env.ledger().set_sequence_number(120_050);

    // Check denied status after advance
    assert!(bridge.is_denied(&bad_actor));

    // Query denied address list
    let denied_list = bridge.get_denied_addresses(&0, &10);
    assert_eq!(denied_list.len(), 1);
    assert_eq!(denied_list.get(0).unwrap(), bad_actor);

    // Advance another 100,000 ledgers
    env.ledger().set_sequence_number(220_050);

    // Attempted deposit by bad_actor should be rejected
    token_sac.mint(&bad_actor, &10_000);
    let res = bridge.try_deposit(&bad_actor, &1_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    assert_eq!(res, Err(Ok(Error::AddressDenied)));
}

#[test]
fn test_ttl_advance_fee_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env);
    let fee_recipient = Address::generate(&env);

    // Mint tokens to bridge to back fees
    token_sac.mint(&bridge.address, &100_000);

    // Accrue fee at ledger 10
    env.ledger().set_sequence_number(10);
    bridge.accrue_fee(&token_addr, &40_000);

    // Advance 100,000 ledgers
    env.ledger().set_sequence_number(100_010);

    // Reading fees should extend TTL
    assert_eq!(bridge.get_accrued_fees(&token_addr), 40_000);

    // Accrue additional fees
    bridge.accrue_fee(&token_addr, &20_000);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 60_000);

    // Advance another 80,000 ledgers
    env.ledger().set_sequence_number(180_010);

    // Withdraw fees
    bridge.withdraw_fees(&fee_recipient, &token_addr, &60_000, &0);

    assert_eq!(token_sac.balance(&fee_recipient), 60_000);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}

#[test]
fn test_ttl_advance_multi_cycle_interleaved() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, bridge, _admin, token_addr, _token, token_sac) = setup_bridge(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sanctioned = Address::generate(&env);

    token_sac.mint(&user, &500_000);
    token_sac.mint(&bridge.address, &500_000);

    // Cycle 1: Init & Deny at ledger 100
    env.ledger().set_sequence_number(100);
    bridge.deny_address(&sanctioned);
    bridge.accrue_fee(&token_addr, &15_000);

    // Advance 80,000 ledgers
    env.ledger().set_sequence_number(80_100);
    bridge.deposit(&user, &100_000, &token_addr, &Bytes::new(&env), &0, &0, &None);
    let req_id = bridge.request_withdrawal(&user, &50_000, &token_addr, &None, &0);

    // Advance 80,000 ledgers (total 160,100)
    env.ledger().set_sequence_number(160_100);
    assert!(bridge.is_denied(&sanctioned));
    assert_eq!(bridge.get_accrued_fees(&token_addr), 15_000);

    // Execute withdrawal
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &0);
    assert_eq!(token_sac.balance(&user), 450_000);

    // Advance 100,000 ledgers (total 260,100)
    env.ledger().set_sequence_number(260_100);
    bridge.withdraw_fees(&recipient, &token_addr, &15_000, &0);
    assert_eq!(token_sac.balance(&recipient), 15_000);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);
}
