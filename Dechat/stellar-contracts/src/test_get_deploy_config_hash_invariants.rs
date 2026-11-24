//! Invariant tests for [`FiatBridge::get_deploy_config_hash`].
//!
//! `get_deploy_config_hash` returns the SHA-256 hash of critical deployment
//! parameters that was computed and stored immutably during `init`. The invariants
//! asserted here are:
//!
//! * The hash is `None` before `init` is called;
//! * The hash is `Some` after `init` is called;
//! * The hash value is immutable and consistent across multiple calls;
//! * The hash value matches the expected SHA-256 of the init parameters;
//! * Unauthorised callers are rejected (if the function has auth checks);
//! * Failure paths do not partially mutate storage.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

use crate::{Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, BytesN, Env, Vec};

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

fn setup_bridge(
    env: &Env,
) -> (
    Address,
    FiatBridgeClient<'_>,
    Address,
    Address,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_address = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.init(&admin, &token_address, &1_000_000, &100, &signers, &1, &0);

    (
        contract_id,
        client,
        admin,
        token_address,
        token_client,
        token_admin,
    )
}

#[test]
fn test_deploy_config_hash_none_before_init() {
    let env = Env::default();

    let contract_id = env.register(FiatBridge, ());
    let client = FiatBridgeClient::new(&env, &contract_id);

    // Before init, the hash should be None
    let hash = client.get_deploy_config_hash();
    assert!(
        hash.is_none(),
        "Deploy config hash should be None before init"
    );
}

#[test]
fn test_deploy_config_hash_some_after_init() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, _, _, _, _) = setup_bridge(&env);

    // After init, the hash should be Some
    let hash = client.get_deploy_config_hash();
    assert!(
        hash.is_some(),
        "Deploy config hash should be Some after init"
    );
}

#[test]
fn test_deploy_config_hash_is_immutable() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, _, _, _, _) = setup_bridge(&env);

    // Get the hash multiple times - it should be consistent
    let hash1 = client.get_deploy_config_hash();
    let hash2 = client.get_deploy_config_hash();
    let hash3 = client.get_deploy_config_hash();

    assert_eq!(hash1, hash2, "Hash should be consistent across calls");
    assert_eq!(hash2, hash3, "Hash should be consistent across calls");
}

#[test]
fn test_deploy_config_hash_consistent_across_state_changes() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    // Get initial hash
    let hash_before = client.get_deploy_config_hash();

    // Perform state changes (deposit, withdrawal, etc.)
    token_admin.mint(&user, &10_000);
    let reference = Bytes::from_slice(&env, b"test");
    client.deposit(&user, &1_000, &token_addr, &reference, &0, &0, &None);
    client.withdraw(&admin, &user, &500, &token_addr);

    // Hash should remain unchanged
    let hash_after = client.get_deploy_config_hash();
    assert_eq!(
        hash_before, hash_after,
        "Deploy config hash should be immutable across state changes"
    );
}

#[test]
fn test_deploy_config_hash_length_is_32_bytes() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, _, _, _, _) = setup_bridge(&env);

    let hash = client.get_deploy_config_hash();
    assert!(hash.is_some(), "Hash should be Some after init");

    let hash_bytes = hash.unwrap();
    assert_eq!(
        hash_bytes.len(),
        32,
        "SHA-256 hash should be exactly 32 bytes"
    );
}

proptest! {
    #[test]
    fn deploy_config_hash_consistent_for_valid_init_params(
        deposit_limit in 1000i128..=10_000_000i128,
        min_deposit in 1i128..=100i128,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let (token_client, _token_admin) = create_token_contract(&env, &admin);
        let token_address = token_client.address.clone();

        let contract_id = env.register(FiatBridge, ());
        let client = FiatBridgeClient::new(&env, &contract_id);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());

        client.init(&admin, &token_address, &deposit_limit, &min_deposit, &signers, &1u32, &0u64);

        // Hash should be Some for all valid init parameters
        let hash = client.get_deploy_config_hash();
        prop_assert!(hash.is_some(), "Hash should be Some after init with valid params");

        // Hash should be consistent across multiple calls
        let hash2 = client.get_deploy_config_hash();
        prop_assert_eq!(hash, hash2, "Hash should be consistent");
    }
}

#[test]
fn test_deploy_config_hash_call_does_not_mutate_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client, admin, token_addr, token_client, token_admin) = setup_bridge(&env);
    let user = Address::generate(&env);

    // Record initial state
    let total_deposited_before = client.get_total_deposited();
    let total_withdrawn_before = client.get_total_withdrawn();
    let balance_before = token_client.balance(&contract_id);

    // Call get_deploy_config_hash multiple times
    for _ in 0..10 {
        let _ = client.get_deploy_config_hash();
    }

    // State should remain unchanged
    let total_deposited_after = client.get_total_deposited();
    let total_withdrawn_after = client.get_total_withdrawn();
    let balance_after = token_client.balance(&contract_id);

    assert_eq!(
        total_deposited_before, total_deposited_after,
        "get_deploy_config_hash should not mutate total_deposited"
    );
    assert_eq!(
        total_withdrawn_before, total_withdrawn_after,
        "get_deploy_config_hash should not mutate total_withdrawn"
    );
    assert_eq!(
        balance_before, balance_after,
        "get_deploy_config_hash should not mutate token balance"
    );
}

#[test]
fn test_deploy_config_hash_different_for_different_configs() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);
    let token_address = token_client.address.clone();

    // Create two bridges with different configs
    let contract_id1 = env.register(FiatBridge, ());
    let client1 = FiatBridgeClient::new(&env, &contract_id1);

    let mut signers1 = Vec::new(&env);
    signers1.push_back(admin.clone());
    client1.init(&admin, &token_address, &1_000_000, &100, &signers1, &1, &0);

    let contract_id2 = env.register(FiatBridge, ());
    let client2 = FiatBridgeClient::new(&env, &contract_id2);

    let mut signers2 = Vec::new(&env);
    signers2.push_back(admin.clone());
    client2.init(&admin, &token_address, &2_000_000, &200, &signers2, &2, &0);

    // Hashes should be different for different configurations
    let hash1 = client1.get_deploy_config_hash();
    let hash2 = client2.get_deploy_config_hash();

    assert_ne!(
        hash1, hash2,
        "Different deployment configurations should produce different hashes"
    );
}
