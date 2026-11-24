//! Invariant tests for [`FiatBridge::deny_address`] and
//! [`FiatBridge::remove_denied_address`].
//!
//! These are the only two entry points that mutate the denylist. They keep a
//! triple of storage in step: the `Denied(address)` flag that the guards read,
//! and the `DeniedIndex(i)` / `DeniedCount` log that `get_denied_addresses`
//! enumerates. The invariants asserted here are:
//!
//! * `is_denied` and `get_denied_addresses` agree after any sequence of deny
//!   and remove calls, and the enumeration never lists an address twice
//!   (property test). Before Issue #1405, denying an address twice appended
//!   two index entries, and a single removal tombstoned only one of them, so
//!   an un-denied address kept showing up in `get_denied_addresses`;
//! * `DeniedCount` only grows when a new address is actually denied;
//! * every guarded entry point returns [`Error::AddressDenied`] for a denied
//!   address and succeeds again once the address is removed:
//!   `deposit` (depositor) and `withdraw` / `request_withdrawal` (recipient);
//! * `DenyAddressEvent` / `DenyRemovedEvent` are emitted exactly once for each
//!   real state change, and repeated or no-op calls emit nothing;
//! * callers that cannot satisfy admin auth are rejected and leave no trace.
//!
//! See [`docs/INVARIANT_TESTING.md`](docs/INVARIANT_TESTING.md) for the
//! invariant-testing strategy and contributor checklist.

extern crate std;

use crate::{DataKey, Error, FiatBridge, FiatBridgeClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token, Address, Bytes, Env, Vec,
};

struct Fixture<'a> {
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    admin: Address,
    token_addr: Address,
    token_sac: token::StellarAssetClient<'a>,
}

fn setup_bridge(env: &Env) -> Fixture<'_> {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let token_sac = token::StellarAssetClient::new(env, &token_addr);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1, &0);

    Fixture {
        contract_id,
        bridge,
        admin,
        token_addr,
        token_sac,
    }
}

fn denied_count(env: &Env, contract_id: &Address) -> u64 {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::DeniedCount)
            .unwrap_or(0)
    })
}

/// Number of events named `name` emitted by the bridge in the last invocation.
fn events_named(env: &Env, contract_id: &Address, name: &str) -> usize {
    env.events()
        .all()
        .filter_by_contract(contract_id)
        .events()
        .iter()
        .filter(|e| {
            let soroban_sdk::xdr::ContractEventBody::V0(body) = &e.body;
            !body.topics.is_empty()
                && matches!(
                    &body.topics[0],
                    soroban_sdk::xdr::ScVal::Symbol(sym)
                        if std::str::from_utf8(sym.0.as_slice()).unwrap() == name
                )
        })
        .count()
}

/// Every address `get_denied_addresses` returns, read in one page.
fn listed(bridge: &FiatBridgeClient) -> std::vec::Vec<Address> {
    bridge.get_denied_addresses(&0, &u32::MAX).iter().collect()
}

/// `is_denied` and `get_denied_addresses` agree for every address in `pool`,
/// and the enumeration holds no duplicates.
fn assert_views_agree(bridge: &FiatBridgeClient, pool: &[Address]) {
    let listed = listed(bridge);
    for addr in pool {
        let hits = listed.iter().filter(|a| *a == addr).count();
        assert!(hits <= 1, "get_denied_addresses lists an address twice");
        assert_eq!(
            bridge.is_denied(addr),
            hits == 1,
            "is_denied and get_denied_addresses disagree"
        );
    }
}

// ── Enumeration consistency ──────────────────────────────────────────────

#[test]
fn deny_then_remove_leaves_views_consistent() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    fx.bridge.deny_address(&a);
    fx.bridge.deny_address(&b);
    assert_views_agree(&fx.bridge, &[a.clone(), b.clone()]);

    fx.bridge.remove_denied_address(&a);
    assert_views_agree(&fx.bridge, &[a.clone(), b.clone()]);
    assert_eq!(listed(&fx.bridge), std::vec![b]);
}

/// Regression for Issue #1405: a double deny followed by a single remove must
/// not leave the address in `get_denied_addresses`.
#[test]
fn double_deny_then_remove_does_not_leave_stale_entry() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let target = Address::generate(&env);

    fx.bridge.deny_address(&target);
    fx.bridge.deny_address(&target);
    assert_eq!(listed(&fx.bridge).len(), 1);

    fx.bridge.remove_denied_address(&target);
    assert!(!fx.bridge.is_denied(&target));
    assert!(listed(&fx.bridge).is_empty());
}

#[test]
fn denied_count_grows_only_for_new_denials() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let target = Address::generate(&env);

    fx.bridge.deny_address(&target);
    assert_eq!(denied_count(&env, &fx.contract_id), 1);

    fx.bridge.deny_address(&target);
    assert_eq!(denied_count(&env, &fx.contract_id), 1);

    fx.bridge.remove_denied_address(&target);
    fx.bridge.remove_denied_address(&target);
    assert_eq!(denied_count(&env, &fx.contract_id), 1);
}

#[derive(Clone, Debug)]
enum Op {
    Deny(usize),
    Remove(usize),
}

fn op_strategy(pool: usize) -> impl Strategy<Value = Op> {
    prop_oneof![(0..pool).prop_map(Op::Deny), (0..pool).prop_map(Op::Remove),]
}

const POOL: usize = 4;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    /// After any sequence of deny and remove calls, the denylist matches a
    /// plain set model, and `is_denied` agrees with `get_denied_addresses`.
    #[test]
    fn prop_is_denied_and_enumeration_always_agree(
        ops in prop::collection::vec(op_strategy(POOL), 1..24),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let fx = setup_bridge(&env);
        let pool: std::vec::Vec<Address> =
            (0..POOL).map(|_| Address::generate(&env)).collect();
        let mut model = [false; POOL];

        for op in ops {
            match op {
                Op::Deny(i) => {
                    fx.bridge.deny_address(&pool[i]);
                    model[i] = true;
                }
                Op::Remove(i) => {
                    fx.bridge.remove_denied_address(&pool[i]);
                    model[i] = false;
                }
            }

            let listed = listed(&fx.bridge);
            for (i, addr) in pool.iter().enumerate() {
                let hits = listed.iter().filter(|a| *a == addr).count();
                prop_assert!(hits <= 1, "address listed twice");
                prop_assert_eq!(fx.bridge.is_denied(addr), model[i]);
                prop_assert_eq!(hits == 1, model[i]);
            }
            prop_assert_eq!(listed.len(), model.iter().filter(|d| **d).count());
        }
    }
}

// ── Guarded entry points ─────────────────────────────────────────────────

#[test]
fn deposit_rejected_while_denied_and_allowed_after_removal() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let user = Address::generate(&env);
    fx.token_sac.mint(&user, &1_000);

    fx.bridge.deny_address(&user);
    assert_eq!(
        fx.bridge.try_deposit(
            &user,
            &100,
            &fx.token_addr,
            &Bytes::new(&env),
            &0,
            &0,
            &None
        ),
        Err(Ok(Error::AddressDenied))
    );
    assert_eq!(fx.bridge.get_user_lifetime_deposited(&user), 0);

    fx.bridge.remove_denied_address(&user);
    fx.bridge.deposit(
        &user,
        &100,
        &fx.token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(fx.bridge.get_user_lifetime_deposited(&user), 100);
}

#[test]
fn withdraw_rejected_while_denied_and_allowed_after_removal() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let user = Address::generate(&env);
    fx.token_sac.mint(&user, &1_000);
    fx.bridge.deposit(
        &user,
        &500,
        &fx.token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    fx.bridge.deny_address(&user);
    assert_eq!(
        fx.bridge
            .try_withdraw(&fx.admin, &user, &100, &fx.token_addr),
        Err(Ok(Error::AddressDenied))
    );

    fx.bridge.remove_denied_address(&user);
    fx.bridge.withdraw(&fx.admin, &user, &100, &fx.token_addr);
    assert_eq!(token::Client::new(&env, &fx.token_addr).balance(&user), 600);
}

#[test]
fn request_withdrawal_rejected_while_denied_and_allowed_after_removal() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let user = Address::generate(&env);
    fx.token_sac.mint(&user, &1_000);
    fx.bridge.deposit(
        &user,
        &500,
        &fx.token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    fx.bridge.deny_address(&user);
    assert_eq!(
        fx.bridge
            .try_request_withdrawal(&user, &100, &fx.token_addr, &None, &0),
        Err(Ok(Error::AddressDenied))
    );
    assert_eq!(fx.bridge.get_total_liabilities(), 0);

    fx.bridge.remove_denied_address(&user);
    let id = fx
        .bridge
        .request_withdrawal(&user, &100, &fx.token_addr, &None, &0);
    assert!(fx.bridge.get_withdrawal_request(&id).is_some());
    assert_eq!(fx.bridge.get_total_liabilities(), 100);
}

#[test]
fn denying_one_address_does_not_block_another() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let denied = Address::generate(&env);
    let bystander = Address::generate(&env);
    fx.token_sac.mint(&bystander, &1_000);

    fx.bridge.deny_address(&denied);
    fx.bridge.deposit(
        &bystander,
        &100,
        &fx.token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    assert_eq!(fx.bridge.get_user_lifetime_deposited(&bystander), 100);
}

// ── Events ───────────────────────────────────────────────────────────────

#[test]
fn deny_emits_one_event_per_real_change() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let target = Address::generate(&env);

    fx.bridge.deny_address(&target);
    assert_eq!(events_named(&env, &fx.contract_id, "deny_address_event"), 1);

    // Already denied: no state change, so no event.
    fx.bridge.deny_address(&target);
    assert_eq!(events_named(&env, &fx.contract_id, "deny_address_event"), 0);
}

#[test]
fn remove_emits_one_event_per_real_change() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let target = Address::generate(&env);

    // Never denied: nothing to remove, so no event.
    fx.bridge.remove_denied_address(&target);
    assert_eq!(events_named(&env, &fx.contract_id, "deny_removed_event"), 0);

    fx.bridge.deny_address(&target);
    fx.bridge.remove_denied_address(&target);
    assert_eq!(events_named(&env, &fx.contract_id, "deny_removed_event"), 1);

    fx.bridge.remove_denied_address(&target);
    assert_eq!(events_named(&env, &fx.contract_id, "deny_removed_event"), 0);
}

// ── Authorisation ────────────────────────────────────────────────────────

#[test]
fn non_admin_cannot_mutate_the_denylist() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup_bridge(&env);
    let already = Address::generate(&env);
    let target = Address::generate(&env);
    fx.bridge.deny_address(&already);

    // Drop the blanket auth mock so `admin.require_auth()` genuinely fails.
    env.set_auths(&[]);
    assert!(fx.bridge.try_deny_address(&target).is_err());
    assert!(fx.bridge.try_remove_denied_address(&already).is_err());

    env.mock_all_auths();
    assert!(!fx.bridge.is_denied(&target));
    assert!(fx.bridge.is_denied(&already));
    assert_eq!(listed(&fx.bridge), std::vec![already]);
    assert_eq!(denied_count(&env, &fx.contract_id), 1);
}
