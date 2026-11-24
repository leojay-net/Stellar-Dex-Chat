//! Tests that [`FiatBridge::execute_withdrawal`] honours the denylist.
//!
//! `request_withdrawal` rejects denied recipients, but an address can be
//! denied after its request was queued. `execute_withdrawal` must then refuse
//! to pay out with [`Error::AddressDenied`] without touching state, and the
//! request must become executable again once the address is removed.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, Env, Vec,
};

use crate::{Error, FiatBridge, FiatBridgeClient};

fn setup(env: &Env) -> (FiatBridgeClient<'_>, Address, token::Client<'_>, Address, u64) {
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token_client = token::Client::new(env, &token_addr);
    let token_admin = token::StellarAssetClient::new(env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_addr, &1_000_000, &100, &signers, &1, &0);
    bridge.set_lock_period(&100);

    let user = Address::generate(env);
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(env, b"denylist_deposit");
    bridge.deposit(&user, &5_000, &token_addr, &reference, &0, &0, &None);

    let req_id = bridge.request_withdrawal(&user, &2_000, &token_addr, &None, &0);
    env.ledger().with_mut(|l| l.sequence_number += 105);

    (bridge, contract_id, token_client, user, req_id)
}

#[test]
fn execute_withdrawal_rejects_recipient_denied_after_request() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, contract_id, token_client, user, req_id) = setup(&env);

    bridge.deny_address(&user);

    let liabilities_before = bridge.get_total_liabilities();
    let depth_before = bridge.get_wq_depth();
    let request_before = bridge.get_withdrawal_request(&req_id);
    let nonce_before = bridge.get_withdrawal_execution_nonce(&user);
    let contract_balance_before = token_client.balance(&contract_id);
    let user_balance_before = token_client.balance(&user);

    let result = bridge.try_execute_withdrawal(&req_id, &None, &0, &0, &nonce_before);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));

    assert_eq!(bridge.get_total_liabilities(), liabilities_before);
    assert_eq!(bridge.get_wq_depth(), depth_before);
    assert_eq!(bridge.get_withdrawal_request(&req_id), request_before);
    assert!(request_before.is_some());
    assert_eq!(bridge.get_withdrawal_execution_nonce(&user), nonce_before);
    assert_eq!(bridge.get_total_withdrawn(), 0);
    assert_eq!(token_client.balance(&contract_id), contract_balance_before);
    assert_eq!(token_client.balance(&user), user_balance_before);
}

#[test]
fn execute_withdrawal_rejects_denied_recipient_on_partial_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _, _, user, req_id) = setup(&env);

    bridge.deny_address(&user);

    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    let result = bridge.try_execute_withdrawal(&req_id, &Some(500), &0, &0, &nonce);
    assert_eq!(result, Err(Ok(Error::AddressDenied)));
    assert_eq!(bridge.get_total_liabilities(), 2_000);
}

#[test]
fn execute_withdrawal_succeeds_after_recipient_removed_from_denylist() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, contract_id, token_client, user, req_id) = setup(&env);

    bridge.deny_address(&user);
    let nonce = bridge.get_withdrawal_execution_nonce(&user);
    assert_eq!(
        bridge.try_execute_withdrawal(&req_id, &None, &0, &0, &nonce),
        Err(Ok(Error::AddressDenied))
    );

    bridge.remove_denied_address(&user);

    let user_balance_before = token_client.balance(&user);
    bridge.execute_withdrawal(&req_id, &None, &0, &0, &nonce);

    assert_eq!(token_client.balance(&user), user_balance_before + 2_000);
    assert_eq!(token_client.balance(&contract_id), 3_000);
    assert_eq!(bridge.get_total_liabilities(), 0);
    assert_eq!(bridge.get_wq_depth(), 0);
    assert!(bridge.get_withdrawal_request(&req_id).is_none());
    assert_eq!(bridge.get_withdrawal_execution_nonce(&user), nonce + 1);
}
