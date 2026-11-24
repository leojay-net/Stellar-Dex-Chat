//! Invariant tests for the per-token allowlist entry points:
//! [`FiatBridge::set_token_allowlist_enabled`],
//! [`FiatBridge::add_token_allowlist`], [`FiatBridge::remove_token_allowlist`]
//! and their enumeration views [`FiatBridge::get_token_allowlist`] /
//! [`FiatBridge::get_token_allowlist_enabled`].
//!
//! The allowlist gates `deposit` (Issue #354), so a regression either blocks
//! legitimate depositors or lets unlisted ones through. The invariants
//! asserted here are:
//!
//! * with a token's allowlist enabled, an unlisted depositor gets
//!   [`Error::NotAllowed`]; adding them lets the deposit through; removing
//!   them blocks it again;
//! * a token's allowlist never affects deposits of a different token;
//! * `get_token_allowlist` returns only live pairs, with no duplicates, and
//!   `offset` / `limit` page over the same set;
//! * `get_token_allowlist_enabled` holds exactly one entry per token that
//!   reflects the current flag, however often it is toggled (Issue #1406);
//! * callers that cannot satisfy admin auth are rejected and leave no trace.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

extern crate std;

use crate::{
    DataKey, Error, FiatBridge, FiatBridgeClient, TokenAllowlistEnabledEntry, TokenAllowlistEntry,
    TokenConfig,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Bytes, Env, Vec,
};

struct Fixture<'a> {
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    token_addr: Address,
    token_sac: token::StellarAssetClient<'a>,
}

fn new_token(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env))
        .address()
}

fn setup_bridge(env: &Env) -> Fixture<'_> {
    let admin = Address::generate(env);
    let token_addr = new_token(env);
    let token_sac = token::StellarAssetClient::new(env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1, &0);

    Fixture {
        contract_id,
        bridge,
        token_addr,
        token_sac,
    }
}

/// Registers a second token directly in storage. `init` only registers one
/// token and there is no public entry point for more.
fn register_second_token(env: &Env, contract_id: &Address) -> Address {
    let token = new_token(env);
    let config = TokenConfig {
        limit: 1_000_000,
        daily_deposit_limit: 0,
        total_deposited: 0,
        total_withdrawn: 0,
        total_liabilities: 0,
    };
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token.clone()), &config);
    });
    token
}

fn funded_user(env: &Env, sac: &token::StellarAssetClient) -> Address {
    let user = Address::generate(env);
    sac.mint(&user, &10_000);
    user
}

fn try_deposit(
    env: &Env,
    bridge: &FiatBridgeClient,
    user: &Address,
    token: &Address,
) -> Result<(), Error> {
    match bridge.try_deposit(user, &100, token, &Bytes::new(env), &0, &0, &None) {
        Ok(Ok(_)) => Ok(()),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected deposit result: {other:?}"),
    }
}

fn allowlist(bridge: &FiatBridgeClient) -> std::vec::Vec<TokenAllowlistEntry> {
    bridge.get_token_allowlist(&0, &u32::MAX).iter().collect()
}

fn enabled_entries(bridge: &FiatBridgeClient) -> std::vec::Vec<TokenAllowlistEnabledEntry> {
    bridge
        .get_token_allowlist_enabled(&0, &u32::MAX)
        .iter()
        .collect()
}

fn entry(token: &Address, address: &Address) -> TokenAllowlistEntry {
    TokenAllowlistEntry {
        token: token.clone(),
        address: address.clone(),
    }
}

// ── Deposit gating ───────────────────────────────────────────────────────

#[test]
fn deposit_gate_follows_add_and_remove() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx.token_sac);

    // Disabled by default: anyone may deposit.
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &fx.token_addr), Ok(()));

    fx.bridge.set_token_allowlist_enabled(&fx.token_addr, &true);
    env.ledger().with_mut(|li| li.sequence_number += 1);
    assert_eq!(
        try_deposit(&env, &fx.bridge, &user, &fx.token_addr),
        Err(Error::NotAllowed)
    );

    fx.bridge.add_token_allowlist(&fx.token_addr, &user);
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &fx.token_addr), Ok(()));

    fx.bridge.remove_token_allowlist(&fx.token_addr, &user);
    env.ledger().with_mut(|li| li.sequence_number += 1);
    assert_eq!(
        try_deposit(&env, &fx.bridge, &user, &fx.token_addr),
        Err(Error::NotAllowed)
    );

    // Disabling the gate lets unlisted depositors back in.
    fx.bridge
        .set_token_allowlist_enabled(&fx.token_addr, &false);
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &fx.token_addr), Ok(()));
}

#[test]
fn rejected_deposit_moves_no_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let user = funded_user(&env, &fx.token_sac);
    fx.bridge.set_token_allowlist_enabled(&fx.token_addr, &true);

    assert_eq!(
        try_deposit(&env, &fx.bridge, &user, &fx.token_addr),
        Err(Error::NotAllowed)
    );
    assert_eq!(fx.bridge.get_user_deposited(&user), 0);
    assert_eq!(
        token::Client::new(&env, &fx.token_addr).balance(&user),
        10_000
    );
}

#[test]
fn allowlist_on_one_token_does_not_affect_another() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let other = register_second_token(&env, &fx.contract_id);
    let other_sac = token::StellarAssetClient::new(&env, &other);

    let user = funded_user(&env, &fx.token_sac);
    other_sac.mint(&user, &10_000);

    // Gate `other` only, and list the user on `other` only.
    fx.bridge.set_token_allowlist_enabled(&other, &true);
    assert_eq!(
        try_deposit(&env, &fx.bridge, &user, &other),
        Err(Error::NotAllowed)
    );
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &fx.token_addr), Ok(()));

    fx.bridge.add_token_allowlist(&other, &user);
    env.ledger().with_mut(|li| li.sequence_number += 1);
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &other), Ok(()));

    // Gating the primary token does not reuse the user's `other` listing.
    fx.bridge.set_token_allowlist_enabled(&fx.token_addr, &true);
    env.ledger().with_mut(|li| li.sequence_number += 1);
    assert_eq!(
        try_deposit(&env, &fx.bridge, &user, &fx.token_addr),
        Err(Error::NotAllowed)
    );
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &other), Ok(()));
}

// ── Enumeration ──────────────────────────────────────────────────────────

#[test]
fn get_token_allowlist_returns_only_live_entries() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let t = fx.token_addr.clone();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    fx.bridge.add_token_allowlist(&t, &a);
    fx.bridge.add_token_allowlist(&t, &b);
    fx.bridge.add_token_allowlist(&t, &c);
    fx.bridge.remove_token_allowlist(&t, &b);

    assert_eq!(
        allowlist(&fx.bridge),
        std::vec![entry(&t, &a), entry(&t, &c)]
    );
}

#[test]
fn duplicate_add_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let t = fx.token_addr.clone();
    let a = Address::generate(&env);

    fx.bridge.add_token_allowlist(&t, &a);
    fx.bridge.add_token_allowlist(&t, &a);
    assert_eq!(allowlist(&fx.bridge), std::vec![entry(&t, &a)]);

    // One removal clears it completely.
    fx.bridge.remove_token_allowlist(&t, &a);
    assert!(allowlist(&fx.bridge).is_empty());

    // Removing again is harmless.
    fx.bridge.remove_token_allowlist(&t, &a);
    assert!(allowlist(&fx.bridge).is_empty());
}

#[test]
fn readd_after_remove_lists_once() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let t = fx.token_addr.clone();
    let a = Address::generate(&env);

    fx.bridge.add_token_allowlist(&t, &a);
    fx.bridge.remove_token_allowlist(&t, &a);
    fx.bridge.add_token_allowlist(&t, &a);
    assert_eq!(allowlist(&fx.bridge), std::vec![entry(&t, &a)]);
}

#[test]
fn pagination_pages_over_live_entries() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let t = fx.token_addr.clone();
    let users: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&env)).collect();
    for u in &users {
        fx.bridge.add_token_allowlist(&t, u);
    }
    // Leave a tombstone at index 1.
    fx.bridge.remove_token_allowlist(&t, &users[1]);

    let live = allowlist(&fx.bridge);
    assert_eq!(live.len(), 4);
    assert!(!live.contains(&entry(&t, &users[1])));

    // `limit` counts live entries only.
    let first: std::vec::Vec<_> = fx.bridge.get_token_allowlist(&0, &2).iter().collect();
    assert_eq!(first, std::vec![entry(&t, &users[0]), entry(&t, &users[2])]);

    // `offset` is a raw index position, so starting past the tombstone
    // skips it without dropping a live entry.
    let rest: std::vec::Vec<_> = fx.bridge.get_token_allowlist(&3, &10).iter().collect();
    assert_eq!(rest, std::vec![entry(&t, &users[3]), entry(&t, &users[4])]);

    assert_eq!(fx.bridge.get_token_allowlist(&0, &0).len(), 0);
    assert_eq!(fx.bridge.get_token_allowlist(&100, &10).len(), 0);
}

#[test]
fn toggling_keeps_one_current_entry_per_token() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let t = fx.token_addr.clone();
    let other = new_token(&env);

    fx.bridge.set_token_allowlist_enabled(&t, &true);
    fx.bridge.set_token_allowlist_enabled(&t, &false);
    fx.bridge.set_token_allowlist_enabled(&t, &true);
    fx.bridge.set_token_allowlist_enabled(&other, &true);
    fx.bridge.set_token_allowlist_enabled(&t, &false);

    assert_eq!(
        enabled_entries(&fx.bridge),
        std::vec![
            TokenAllowlistEnabledEntry {
                token: t.clone(),
                enabled: false
            },
            TokenAllowlistEnabledEntry {
                token: other.clone(),
                enabled: true
            },
        ]
    );

    let page: std::vec::Vec<_> = fx
        .bridge
        .get_token_allowlist_enabled(&1, &1)
        .iter()
        .collect();
    assert_eq!(
        page,
        std::vec![TokenAllowlistEnabledEntry {
            token: other,
            enabled: true
        }]
    );
}

// ── Authorisation ────────────────────────────────────────────────────────

#[test]
fn non_admin_cannot_mutate_the_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let t = fx.token_addr.clone();
    let listed = Address::generate(&env);
    let intruder = Address::generate(&env);
    fx.bridge.add_token_allowlist(&t, &listed);

    // Drop the blanket auth mock so `admin.require_auth()` genuinely fails.
    env.set_auths(&[]);
    assert!(fx
        .bridge
        .try_set_token_allowlist_enabled(&t, &true)
        .is_err());
    assert!(fx.bridge.try_add_token_allowlist(&t, &intruder).is_err());
    assert!(fx.bridge.try_remove_token_allowlist(&t, &listed).is_err());

    env.mock_all_auths();
    assert_eq!(allowlist(&fx.bridge), std::vec![entry(&t, &listed)]);
    assert!(enabled_entries(&fx.bridge).is_empty());

    // The gate is still off, so the rejected enable had no effect.
    let user = funded_user(&env, &fx.token_sac);
    assert_eq!(try_deposit(&env, &fx.bridge, &user, &t), Ok(()));
}
