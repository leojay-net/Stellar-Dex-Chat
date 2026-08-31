//! Soroban invariant tests for `get_multisig_signers`.
//!
//! `get_multisig_signers` is a read-only accessor over `DataKey::Signers`. The
//! invariants asserted here are that it faithfully reflects the signer set
//! installed by `init`, that it is pure (no storage mutation, no accounting
//! drift), and that it degrades to an empty vector rather than panicking when
//! the contract has never been initialised.
//!
//! The property-based cases use `proptest` over the signer-count / threshold
//! input space, mirroring `test_deposit_fuzz.rs`.
//!
//! Registered from `lib.rs` behind `#[cfg(test)]`. See
//! [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{FiatBridge, FiatBridgeClient, MAX_SIGNERS};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, Vec};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &contract_address.address()),
        token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

/// Register a bridge and initialise it with `signer_count` distinct signers and
/// the supplied threshold. Returns the client plus the exact signer vector that
/// was handed to `init`, so tests can compare against the input.
fn setup_bridge_with_signers<'a>(
    env: &Env,
    signer_count: u32,
    threshold: u32,
) -> (FiatBridgeClient<'a>, Address, Vec<Address>) {
    let admin = Address::generate(env);
    let (token_client, _token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    // The admin is always the first signer so that the duplicate check in
    // `init` is satisfied while keeping the admin inside the signer set.
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &threshold, &0);

    (client, admin, signers)
}

/// Baseline: an uninitialised contract must return an empty vector rather than
/// panicking on the missing `DataKey::Signers` entry.
#[test]
fn uninitialised_contract_returns_empty_signer_set() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let signers = client.get_multisig_signers();

    assert_eq!(signers.len(), 0);
    assert_eq!(signers, Vec::new(&env));
}

/// The accessor must return precisely what `init` stored: same length, same
/// order, same membership.
#[test]
fn returns_exactly_the_initialised_signer_set() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, expected) = setup_bridge_with_signers(&env, 3, 2);

    let actual = client.get_multisig_signers();

    assert_eq!(actual, expected);
    assert_eq!(actual.len(), expected.len());
    for (i, signer) in expected.iter().enumerate() {
        assert_eq!(actual.get(i as u32).unwrap(), signer);
    }
}

/// Purity: repeated calls observe the same value and leave the signer set and
/// the surrounding accounting totals untouched.
#[test]
fn repeated_calls_are_idempotent_and_do_not_mutate_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, expected) = setup_bridge_with_signers(&env, 4, 3);

    let deposited_before = client.get_total_deposited();
    let withdrawn_before = client.get_total_withdrawn();
    let liabilities_before = client.get_total_liabilities();
    let threshold_before = client.get_multisig_threshold();

    let first = client.get_multisig_signers();
    for _ in 0..5 {
        assert_eq!(client.get_multisig_signers(), first);
    }

    assert_eq!(first, expected);
    // Accounting totals stay consistent across the read.
    assert_eq!(client.get_total_deposited(), deposited_before);
    assert_eq!(client.get_total_withdrawn(), withdrawn_before);
    assert_eq!(client.get_total_liabilities(), liabilities_before);
    // The companion multisig field is untouched too.
    assert_eq!(client.get_multisig_threshold(), threshold_before);
}

/// The accessor is unauthenticated by design: it is a public view. Reading it
/// from a non-signer, non-admin context must succeed and must not mutate the
/// signer set, so an unprivileged caller gains nothing and changes nothing.
#[test]
fn unprivileged_caller_reads_without_mutating() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, expected) = setup_bridge_with_signers(&env, 3, 2);

    let outsider = Address::generate(&env);
    assert!(!expected.contains(&outsider));

    let before = client.get_multisig_signers();
    let observed = client.get_multisig_signers();
    let after = client.get_multisig_signers();

    assert_eq!(observed, expected);
    assert_eq!(before, after);
    // The outsider is not smuggled into the signer set by the read.
    assert!(!client.get_multisig_signers().contains(&outsider));
}

/// The returned set never contains duplicates, because `init` rejects duplicate
/// signers outright.
#[test]
fn returned_signer_set_is_duplicate_free() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _expected) = setup_bridge_with_signers(&env, 6, 4);

    let signers = client.get_multisig_signers();

    let mut seen = Vec::<Address>::new(&env);
    for s in signers.iter() {
        assert!(!seen.contains(&s), "duplicate signer returned");
        seen.push_back(s);
    }
    assert_eq!(seen.len(), signers.len());
}

/// A failed `init` must leave no partial signer state behind: the accessor
/// still reports an empty set.
#[test]
fn failed_init_leaves_no_partial_signer_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, _) = create_token_contract(&env, &admin);
    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(&env));

    // A threshold of 0 is invalid, so `init` must fail.
    let result = client.try_init(
        &admin,
        &token_client.address,
        &1_000_000,
        &100,
        &signers,
        &0,
        &0,
    );
    assert!(result.is_err());

    assert_eq!(client.get_multisig_signers().len(), 0);
}

proptest! {
    /// For every valid (signer_count, threshold) pair the accessor returns a
    /// set whose length equals the number of signers supplied to `init`, and
    /// whose threshold remains within `1..=len`.
    #[test]
    fn signer_set_length_matches_init_for_all_valid_inputs(
        signer_count in 1u32..=MAX_SIGNERS,
        threshold_seed in 0u32..MAX_SIGNERS,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        // Derive a threshold that is always valid: 1 <= threshold <= signer_count.
        let threshold = (threshold_seed % signer_count) + 1;

        let (client, _admin, expected) =
            setup_bridge_with_signers(&env, signer_count, threshold);

        let actual = client.get_multisig_signers();

        prop_assert_eq!(actual.len(), signer_count);
        prop_assert_eq!(actual.len(), expected.len());
        prop_assert_eq!(actual, expected);

        let stored_threshold = client.get_multisig_threshold();
        prop_assert_eq!(stored_threshold, threshold);
        prop_assert!(stored_threshold >= 1);
        prop_assert!(stored_threshold <= signer_count);
    }

    /// Reading the signer set an arbitrary number of times is observationally
    /// equivalent to reading it once.
    #[test]
    fn arbitrary_read_counts_do_not_drift(
        signer_count in 1u32..=8u32,
        reads in 1u32..=12u32,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let (client, _admin, expected) = setup_bridge_with_signers(&env, signer_count, 1);

        let deposited_before = client.get_total_deposited();

        let mut last = client.get_multisig_signers();
        for _ in 0..reads {
            let current = client.get_multisig_signers();
            prop_assert_eq!(current.clone(), last.clone());
            last = current;
        }

        prop_assert_eq!(last, expected);
        prop_assert_eq!(client.get_total_deposited(), deposited_before);
    }
}
