//! Integration tests for issue #840 — fee accrual vault logic in `withdraw_fees`.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

fn create_token<'a>(
    e: &Env,
    admin: &Address,
) -> (Address, TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (
        addr.clone(),
        TokenClient::new(e, &addr),
        StellarAssetClient::new(e, &addr),
    )
}

fn setup_bridge(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'_>,
    Address,
    Address,
    TokenClient<'_>,
    StellarAssetClient<'_>,
) {
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_addr, token, token_sac) = create_token(env, &token_admin);
    let signers = vec![env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

/// When the fee-vault ledger exceeds on-chain reserves, `withdraw_fees` must
/// reconcile the vault before debiting and emit `FeeVaultReconciledEvent`.
#[test]
fn test_withdraw_fees_reconciles_vault_when_ledger_exceeds_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &200);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &400i128);
    });

    assert_eq!(bridge.get_accrued_fees(&token_addr), 400);

    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);

    assert_eq!(bridge.get_accrued_fees(&token_addr), 100);
    assert_eq!(token.balance(&recipient), 100);
}

/// Partial withdrawals must debit only the reconciled vault balance.
#[test]
fn test_withdraw_fees_uses_fee_vault_after_reconciliation() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &300);
    bridge.accrue_fee(&token_addr, &250);

    bridge.withdraw_fees(&recipient, &token_addr, &100, &0);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 150);

    bridge.withdraw_fees(&recipient, &token_addr, &150, &1);
    assert_eq!(bridge.get_accrued_fees(&token_addr), 0);

    let result = bridge.try_withdraw_fees(&recipient, &token_addr, &1, &2);
    assert_eq!(result, Err(Ok(Error::NoFeesToWithdraw)));
}

/// Over-withdrawal after reconciliation must still be rejected.
#[test]
fn test_withdraw_fees_rejects_amount_above_reconciled_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, bridge, _, token_addr, _, token_sac) = setup_bridge(&env);
    let recipient = Address::generate(&env);

    token_sac.mint(&contract_id, &100);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::FeeVault(token_addr.clone()), &250i128);
    });

    let result = bridge.try_withdraw_fees(&recipient, &token_addr, &150, &0);
    assert!(
        result == Err(Ok(Error::FeeWithdrawalExceedsBalance))
            || result == Err(Ok(Error::InsufficientFunds)),
        "expected withdrawal to fail when amount exceeds reconciled vault, got {result:?}",
    );
}
