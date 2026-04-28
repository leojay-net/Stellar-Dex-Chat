//! Integration tests for admin co-authentication on `deposit`.
//!
//! The deposit path requires both the depositor and the admin to authorize,
//! and the emitted [`DepositEvent`] is enriched with the admin address that
//! co-signed.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    vec,
    xdr::{ContractEventBody, ScSymbol, ScVal, StringM},
    Address, Bytes, Env, IntoVal, Vec,
};

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let addr = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let sac = StellarAssetClient::new(env, &addr);
    (addr, sac)
}

struct Fixture<'a> {
    env: Env,
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    admin: Address,
    token_addr: Address,
    user: Address,
}

fn setup_fixture() -> Fixture<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_addr, token_sac) = create_token(&env, &token_admin);

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);

    let user = Address::generate(&env);
    token_sac.mint(&user, &10_000);

    Fixture {
        env,
        contract_id,
        bridge,
        admin,
        token_addr,
        user,
    }
}

#[test]
fn deposit_succeeds_when_admin_co_authorizes() {
    let f = setup_fixture();

    // mock_all_auths in setup means both `from` and `admin` are treated as
    // having signed — the happy path under typical testing.
    f.bridge.deposit(
        &f.user,
        &500,
        &f.token_addr,
        &Bytes::new(&f.env),
        &0,
        &0,
        &None,
    );

    // Deposit landed: contract holds the funds.
    let token = soroban_sdk::token::Client::new(&f.env, &f.token_addr);
    assert_eq!(token.balance(&f.contract_id), 500);
    assert_eq!(token.balance(&f.user), 9_500);
}

#[test]
fn deposit_event_carries_admin_address() {
    let f = setup_fixture();

    f.bridge.deposit(
        &f.user,
        &250,
        &f.token_addr,
        &Bytes::new(&f.env),
        &0,
        &0,
        &None,
    );

    // Inspect the raw XDR of bridge events and find the DepositEvent.
    // The #[contractevent] macro emits a single topic equal to the
    // snake-case struct name; the data is a Map containing the struct
    // fields keyed by their snake_case names.
    let bridge_events = f.env.events().all().filter_by_contract(&f.contract_id);
    let raw = bridge_events.events();

    let deposit_topic = ScVal::Symbol(ScSymbol(
        StringM::try_from("deposit_event").expect("valid event topic"),
    ));
    let admin_key = ScVal::Symbol(ScSymbol(
        StringM::try_from("admin").expect("valid field name"),
    ));
    let expected_admin: ScVal = (&f.admin).try_into().expect("address → ScVal");

    let mut saw_admin = false;
    for event in raw.iter() {
        let ContractEventBody::V0(body) = &event.body;
        if !body.topics.iter().any(|t| t == &deposit_topic) {
            continue;
        }
        if let ScVal::Map(Some(map)) = &body.data {
            let admin_entry = map
                .iter()
                .find(|entry| entry.key == admin_key)
                .expect("DepositEvent map must contain `admin`");
            assert_eq!(admin_entry.val, expected_admin);
            saw_admin = true;
            break;
        }
    }
    assert!(
        saw_admin,
        "expected a DepositEvent with admin field to be emitted; got {:?}",
        raw
    );
}

#[test]
fn deposit_fails_when_admin_does_not_co_authorize() {
    // Build a fixture but DO NOT use mock_all_auths — instead, provide a
    // narrow MockAuth list that only contains the depositor's signature.
    // Without the admin's auth the contract's `admin.require_auth()` call
    // must reject the invocation.
    let env = Env::default();

    // Initialise the bridge with mock_all_auths so init() succeeds, then
    // switch to scoped auths for the deposit call we actually want to test.
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_addr, token_sac) = create_token(&env, &token_admin);
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let signers = vec![&env, admin.clone()];
    bridge.init(&admin, &token_addr, &1_000_000, &1, &signers, &1);
    let user = Address::generate(&env);
    token_sac.mint(&user, &5_000);

    // Reduce auth scope: only the user (and the SAC transfer sub-call) are
    // signed. Crucially, the admin is NOT in the auth list — so the
    // bridge's admin.require_auth() inside deposit() must fail.
    let amount: i128 = 100;
    let reference = Bytes::new(&env);
    let expected_price: i128 = 0;
    let max_slippage: u32 = 0;
    let memo: Option<soroban_sdk::BytesN<32>> = None;

    let deposit_args: soroban_sdk::Vec<soroban_sdk::Val> = (
        user.clone(),
        amount,
        token_addr.clone(),
        reference.clone(),
        expected_price,
        max_slippage,
        memo.clone(),
    )
        .into_val(&env);

    let transfer_args: soroban_sdk::Vec<soroban_sdk::Val> =
        (user.clone(), contract_id.clone(), amount).into_val(&env);

    env.mock_auths(&[MockAuth {
        address: &user,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "deposit",
            args: deposit_args,
            sub_invokes: &[MockAuthInvoke {
                contract: &token_addr,
                fn_name: "transfer",
                args: transfer_args,
                sub_invokes: &[],
            }],
        },
    }]);

    let result = bridge.try_deposit(
        &user,
        &amount,
        &token_addr,
        &reference,
        &expected_price,
        &max_slippage,
        &memo,
    );

    // Without admin auth the host's auth manager rejects the call before
    // any contract logic returns an Error code, so we just assert the
    // invocation fails (not Ok).
    assert!(
        result.is_err(),
        "deposit must fail when the admin has not co-authorized; got {:?}",
        result
    );
}
