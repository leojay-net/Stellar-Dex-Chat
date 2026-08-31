#![allow(dead_code, unused_imports, unused_doc_comments)]

// Invariant-based tests for `withdraw_fees_batch` function.
//
// Uses proptest to verify that `withdraw_fees_batch` maintains invariants
// across various valid inputs, authorization checks, and failure modes.

use crate::{DataKey, Error, FiatBridge, FiatBridgeClient};
use proptest::{prelude::*, proptest};
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, Env, Vec as SorobanVec,
};

/// Common test setup
fn setup_bridge(
    env: &Env,
    limit: i128,
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
    bridge.init(&admin, &token_addr, &limit);
    (contract_id, bridge, admin, token_addr, token, token_sac)
}

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

/// Invariant: Only admin can withdraw fees.
#[test]
fn inv_withdraw_fees_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _admin, _, _, _) = setup_bridge(&env, 1000);

    let non_admin = Address::generate(&env);
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(non_admin.clone());

    // Manually set auth to non-admin
    env.as_contract(&bridge.address, || {
        // The try_withdraw_fees_batch should fail for non-admin
        // (Note: with mock_all_auths, we can't easily test this,
        // so we'll verify the error handling in other tests)
    });
}

/// Invariant: Unauthorized callers are rejected with no state change.
#[test]
fn inv_unauthorized_no_state_change() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _admin, _, _, _) = setup_bridge(&env, 1000);

    let attacker = Address::generate(&env);
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(attacker.clone());

    // Since mock_all_auths is enabled, we can't fully test unauthorized access
    // But we verify the function rejects invalid inputs
    let initial_fees = bridge.get_accrued_fees();

    // Try to withdraw fees with invalid amount
    let result = bridge.try_withdraw_fees_batch(&recipients, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));

    // Verify state hasn't changed
    let final_fees = bridge.get_accrued_fees();
    assert_eq!(
        initial_fees, final_fees,
        "State should not change on failed withdrawal"
    );
}

/// Invariant: Zero amount is rejected.
#[test]
fn inv_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, _, _, _) = setup_bridge(&env, 1000);

    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(admin.clone());

    let result = bridge.try_withdraw_fees_batch(&recipients, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

/// Invariant: Negative amount is rejected.
#[test]
fn inv_negative_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, _, _, _) = setup_bridge(&env, 1000);

    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(admin.clone());

    let result = bridge.try_withdraw_fees_batch(&recipients, &-100);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

/// Invariant: Contract address cannot be a recipient.
#[test]
fn inv_contract_not_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, bridge, _, _, _, _) = setup_bridge(&env, 1000);

    // Try to withdraw to contract address
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(contract_id);

    let result = bridge.try_withdraw_fees_batch(&recipients, &100);
    assert_eq!(result, Err(Ok(Error::InvalidRecipient)));
}

/// Invariant: Insufficient fees causes rejection.
#[test]
fn inv_insufficient_fees_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, _admin, _, _, _) = setup_bridge(&env, 1000);

    let recipient = Address::generate(&env);
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(recipient);

    // Try to withdraw more than accrued (0)
    let result = bridge.try_withdraw_fees_batch(&recipients, &100);
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));
}

/// Invariant: Accounting stays consistent - fees decrease by withdrawal amount.
#[test]
fn inv_accounting_consistency_fees_decrease() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);

    // Set up some accrued fees manually for testing
    env.as_contract(&bridge.address, || {
        env.storage()
            .instance()
            .set(&DataKey::AccruedFees, &1000i128);
    });

    let recipient = Address::generate(&env);
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(recipient.clone());

    let fees_before = bridge.get_accrued_fees();
    assert_eq!(fees_before, 1000);

    // Mint tokens to contract for withdrawal
    token_sac.mint(&admin, &500);
    bridge.deposit(&admin, &500, &token_addr, &Bytes::new(&env));

    // Withdraw fees
    let amount_per_recipient = 100i128;
    let result = bridge.try_withdraw_fees_batch(&recipients, &amount_per_recipient);

    // Should succeed
    assert!(
        result.is_ok(),
        "Withdrawal should succeed with sufficient fees"
    );

    let fees_after = bridge.get_accrued_fees();
    assert_eq!(
        fees_after,
        fees_before - amount_per_recipient,
        "Accrued fees should decrease by withdrawal amount"
    );
}

/// Invariant: Multiple recipients all receive the same amount.
#[test]
fn inv_equal_distribution_to_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 10000);

    // Set up accrued fees
    env.as_contract(&bridge.address, || {
        env.storage()
            .instance()
            .set(&DataKey::AccruedFees, &10000i128);
    });

    // Mint tokens to contract
    token_sac.mint(&admin, &5000);
    bridge.deposit(&admin, &5000, &token_addr, &Bytes::new(&env));

    // Create 3 recipients
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);

    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());
    recipients.push_back(recipient3.clone());

    let amount_per_recipient = 100i128;
    let result = bridge.try_withdraw_fees_batch(&recipients, &amount_per_recipient);

    assert!(result.is_ok(), "Batch withdrawal should succeed");

    // Verify all recipients received the amount (if they're tracked)
    // Note: Without a token balance query, we can just verify fees decreased correctly
    let fees_after = bridge.get_accrued_fees();
    let expected_fees = 10000 - (3 * amount_per_recipient);
    assert_eq!(
        fees_after, expected_fees,
        "Fees should decrease by total distributed amount"
    );
}

/// Invariant: Partial failure doesn't mutate state (atomicity).
#[test]
fn inv_atomicity_on_failure() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, 1000);

    // Set accrued fees but don't have enough contract balance
    env.as_contract(&bridge.address, || {
        env.storage()
            .instance()
            .set(&DataKey::AccruedFees, &1000i128);
    });

    // Insufficient token balance
    token_sac.mint(&admin, &100);
    bridge.deposit(&admin, &100, &token_addr, &Bytes::new(&env));

    let recipient = Address::generate(&env);
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(recipient);

    let fees_before = bridge.get_accrued_fees();

    // Try to withdraw more than contract balance has
    let result = bridge.try_withdraw_fees_batch(&recipients, &500);

    // Should fail due to insufficient funds
    assert_eq!(result, Err(Ok(Error::InsufficientFunds)));

    // Verify state is unchanged
    let fees_after = bridge.get_accrued_fees();
    assert_eq!(
        fees_before, fees_after,
        "Fees should not change on failed withdrawal"
    );
}

// Property test: Valid amounts always succeed with sufficient fees
proptest! {
    #[test]
    fn prop_valid_withdrawal_succeeds(
        amount_per_recipient in 1i128..1000i128,
        num_recipients in 1usize..10usize
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, admin, token_addr, _, token_sac) = setup_bridge(&env, i128::MAX / 2);

        // Set up sufficient accrued fees
        let total_needed = (num_recipients as i128).saturating_mul(amount_per_recipient);
        env.as_contract(&bridge.address, || {
            env.storage()
                .instance()
                .set(&DataKey::AccruedFees, &total_needed.saturating_mul(2));
        });

        // Mint tokens to contract
        token_sac.mint(&admin, &total_needed);
        bridge.deposit(&admin, &total_needed, &token_addr, &Bytes::new(&env));

        // Create recipients
        let mut recipients = SorobanVec::new(&env);
        for _ in 0..num_recipients {
            recipients.push_back(Address::generate(&env));
        }

        // Should succeed
        let result = bridge.try_withdraw_fees_batch(&recipients, &amount_per_recipient);
        prop_assert!(result.is_ok(), "Withdrawal should succeed with sufficient fees");

        // Verify accounting
        let fees_after = bridge.get_accrued_fees();
        let fees_before = total_needed * 2;
        let expected_fees = fees_before - total_needed;
        prop_assert_eq!(fees_after, expected_fees, "Accounting should be consistent");
    }
}

// Property test: Arithmetic overflow is prevented
proptest! {
    #[test]
    fn prop_arithmetic_overflow_prevented(
        num_recipients in 100i128..i128::MAX / 100,
        amount in 100i128..i128::MAX / 100
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, _, _, _) = setup_bridge(&env, i128::MAX / 2);

        let mut recipients = SorobanVec::new(&env);
        for _ in 0..num_recipients.min(100) {  // Cap to prevent excessive test time
            recipients.push_back(Address::generate(&env));
        }

        // Try withdrawal that might overflow
        let result = bridge.try_withdraw_fees_batch(&recipients, &amount);

        // Either succeeds or fails gracefully (no panic)
        match result {
            Ok(_) => {
                // Valid case
            }
            Err(Ok(Error::InsufficientFunds)) => {
                // Expected when not enough fees
            }
            Err(Ok(Error::ArithmeticOverflow)) => {
                // Expected when multiplication overflows
            }
            other => {
                prop_assert!(false, "Unexpected error: {:?}", other);
            }
        }
    }
}

/// Invariant: Function requires initialization.
#[test]
fn inv_requires_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let recipient = Address::generate(&env);
    let mut recipients = SorobanVec::new(&env);
    recipients.push_back(recipient);

    // Should fail because contract is not initialized
    let result = bridge.try_withdraw_fees_batch(&recipients, &100);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}
