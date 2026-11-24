//! Tests for issues #1400–#1403:
//!
//! * #1400 – `register_token` / `get_token_config`: a second token gets its own
//!   isolated accounting and is protected from `rescue_token`.
//! * #1401 – the dead global allowlist is gone; the per-token allowlist is the
//!   only gate and `ConfigSnapshot` moved to schema v2.
//! * #1402 – a non-zero `SlippageThreshold` caps the caller's `max_slippage`
//!   on `deposit` and `execute_withdrawal`.
//! * #1403 – `set_operator_daily_limit` is enforced on `withdraw` over a
//!   rolling 24h window.

extern crate std;

use crate::{
    Error, FiatBridge, FiatBridgeClient, TokenConfig, CONFIG_SNAPSHOT_VERSION, WINDOW_LEDGERS,
};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, Env,
};

const FIXED_ONE_USD: i128 = 10_000_000;

/// Oracle quoting $0.95 (a 500 bps drop from $1.00).
#[contract]
pub struct Oracle500BpsDrop;

#[contractimpl]
impl Oracle500BpsDrop {
    pub fn get_price(_env: Env, _token: soroban_sdk::Address) -> Option<i128> {
        Some(9_500_000)
    }
}

/// Oracle quoting $0.995 (a 50 bps drop from $1.00).
#[contract]
pub struct Oracle50BpsDrop;

#[contractimpl]
impl Oracle50BpsDrop {
    pub fn get_price(_env: Env, _token: soroban_sdk::Address) -> Option<i128> {
        Some(9_950_000)
    }
}

struct Fixture<'a> {
    env: Env,
    contract_id: Address,
    bridge: FiatBridgeClient<'a>,
    admin: Address,
    token: Address,
    token_sac: StellarAssetClient<'a>,
}

fn new_token<'a>(env: &Env) -> (Address, TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = env
        .register_stellar_asset_contract_v2(Address::generate(env))
        .address();
    (
        addr.clone(),
        TokenClient::new(env, &addr),
        StellarAssetClient::new(env, &addr),
    )
}

fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let (token, _, token_sac) = new_token(&env);
    bridge.init(
        &admin,
        &token,
        &10_000,
        &1,
        &vec![&env, admin.clone()],
        &1,
        &0,
    );
    Fixture {
        env,
        contract_id,
        bridge,
        admin,
        token,
        token_sac,
    }
}

fn has_event(env: &Env, contract_id: &Address, topic: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal, StringM};
    let topic = ScVal::Symbol(ScSymbol(StringM::try_from(topic).unwrap()));
    env.events()
        .all()
        .filter_by_contract(contract_id)
        .events()
        .iter()
        .any(|e| {
            let ContractEventBody::V0(body) = &e.body;
            body.topics.contains(&topic)
        })
}

fn deposit(f: &Fixture, user: &Address, amount: i128, token: &Address) {
    f.bridge
        .deposit(user, &amount, token, &Bytes::new(&f.env), &0, &0, &None);
}

// ── #1400: register_token / get_token_config ─────────────────────────────

#[test]
fn register_token_creates_isolated_config_and_emits_event() {
    let f = setup();
    let (second, _, _) = new_token(&f.env);

    assert_eq!(f.bridge.get_token_config(&second), None);
    f.bridge.register_token(&second, &5_000, &1_000);

    assert!(has_event(&f.env, &f.contract_id, "token_registered_event"));
    assert_eq!(
        f.bridge.get_token_config(&second),
        Some(TokenConfig {
            limit: 5_000,
            daily_deposit_limit: 1_000,
            total_deposited: 0,
            total_withdrawn: 0,
            total_liabilities: 0,
        })
    );
    // The primary token's entry is reported by the same view.
    assert_eq!(f.bridge.get_token_config(&f.token).unwrap().limit, 10_000);
}

#[test]
fn deposit_into_second_token_is_isolated_from_primary() {
    let f = setup();
    let (second, second_client, second_sac) = new_token(&f.env);
    f.bridge.register_token(&second, &5_000, &0);

    let user = Address::generate(&f.env);
    second_sac.mint(&user, &2_000);
    f.token_sac.mint(&user, &2_000);

    deposit(&f, &user, 700, &second);
    deposit(&f, &user, 300, &f.token);
    f.bridge.request_withdrawal(&user, &200, &second, &None, &0);

    let second_cfg = f.bridge.get_token_config(&second).unwrap();
    assert_eq!(second_cfg.total_deposited, 700);
    assert_eq!(second_cfg.total_liabilities, 200);

    let primary_cfg = f.bridge.get_token_config(&f.token).unwrap();
    assert_eq!(primary_cfg.total_deposited, 300);
    assert_eq!(primary_cfg.total_liabilities, 0);
    // Primary-only views are untouched by the second token.
    assert_eq!(f.bridge.get_total_deposited(), 300);
    assert_eq!(f.bridge.get_total_liabilities(), 0);

    assert_eq!(second_client.balance(&f.contract_id), 700);
    assert_eq!(f.bridge.get_user_available_balance(&user, &second), 500);
}

#[test]
fn second_token_enforces_its_own_limit() {
    let f = setup();
    let (second, _, second_sac) = new_token(&f.env);
    f.bridge.register_token(&second, &500, &0);

    let user = Address::generate(&f.env);
    second_sac.mint(&user, &2_000);
    let res = f
        .bridge
        .try_deposit(&user, &501, &second, &Bytes::new(&f.env), &0, &0, &None);
    assert_eq!(res, Err(Ok(Error::ExceedsLimit)));
}

#[test]
fn rescue_token_is_refused_for_registered_second_token() {
    let f = setup();
    let (second, _, second_sac) = new_token(&f.env);
    second_sac.mint(&f.contract_id, &1_000);
    f.bridge.register_token(&second, &5_000, &0);

    let to = Address::generate(&f.env);
    assert_eq!(
        f.bridge.try_rescue_token(&second, &to, &100),
        Err(Ok(Error::RescueForbidden))
    );
}

#[test]
fn register_token_rejects_duplicates() {
    let f = setup();
    let (second, _, _) = new_token(&f.env);
    f.bridge.register_token(&second, &5_000, &0);

    assert_eq!(
        f.bridge.try_register_token(&second, &1_000, &0),
        Err(Ok(Error::TokenAlreadyRegistered))
    );
    assert_eq!(
        f.bridge.try_register_token(&f.token, &1_000, &0),
        Err(Ok(Error::TokenAlreadyRegistered))
    );
    // The original entry is unchanged.
    assert_eq!(f.bridge.get_token_config(&second).unwrap().limit, 5_000);
}

#[test]
fn register_token_validates_inputs() {
    let f = setup();
    let (second, _, _) = new_token(&f.env);

    assert_eq!(
        f.bridge.try_register_token(&second, &0, &0),
        Err(Ok(Error::ZeroAmount))
    );
    assert_eq!(
        f.bridge.try_register_token(&second, &1_000, &-1),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        f.bridge.try_register_token(&second, &1_000, &1_001),
        Err(Ok(Error::ExceedsLimit))
    );
    assert_eq!(
        f.bridge.try_register_token(&f.contract_id, &1_000, &0),
        Err(Ok(Error::SelfReferentialAddress))
    );
    assert_eq!(f.bridge.get_token_config(&second), None);
}

#[test]
fn register_token_requires_admin_auth() {
    let f = setup();
    let (second, _, _) = new_token(&f.env);
    f.env.set_auths(&[]);
    assert!(f.bridge.try_register_token(&second, &1_000, &0).is_err());
    assert_eq!(f.bridge.get_token_config(&second), None);
}

// ── #1401: per-token allowlist is the only allowlist ─────────────────────

#[test]
fn config_snapshot_is_schema_v2() {
    let f = setup();
    assert_eq!(
        f.bridge.get_config_snapshot().version,
        CONFIG_SNAPSHOT_VERSION
    );
    assert_eq!(CONFIG_SNAPSHOT_VERSION, 2);
}

#[test]
fn per_token_allowlist_is_always_enforced() {
    let f = setup();
    let allowed = Address::generate(&f.env);
    let stranger = Address::generate(&f.env);
    f.token_sac.mint(&allowed, &1_000);
    f.token_sac.mint(&stranger, &1_000);

    // Allowlist off: anyone may deposit.
    deposit(&f, &stranger, 100, &f.token);

    // Allowlist on: only listed addresses may deposit.
    f.bridge.set_token_allowlist_enabled(&f.token, &true);
    f.bridge.add_token_allowlist(&f.token, &allowed);
    deposit(&f, &allowed, 100, &f.token);
    let res = f.bridge.try_deposit(
        &stranger,
        &100,
        &f.token,
        &Bytes::new(&f.env),
        &0,
        &0,
        &None,
    );
    assert_eq!(res, Err(Ok(Error::NotAllowed)));
}

// ── #1402: SlippageThreshold caps max_slippage ──────────────────────────

/// Points the bridge at `oracle` and sets an effectively unlimited fiat cap,
/// since `deposit` only fetches an oracle price when a fiat limit is set.
fn use_oracle(f: &Fixture, oracle: &Address) {
    f.bridge.set_oracle(oracle);
    f.bridge.set_fiat_limit(&i128::MAX);
}

#[test]
fn deposit_caps_caller_slippage_at_admin_threshold() {
    let f = setup();
    use_oracle(&f, &f.env.register(Oracle500BpsDrop, ()));
    let user = Address::generate(&f.env);
    f.token_sac.mint(&user, &5_000);

    // No threshold: the caller's 600 bps tolerance covers a 500 bps drop.
    f.bridge.deposit(
        &user,
        &100,
        &f.token,
        &Bytes::new(&f.env),
        &FIXED_ONE_USD,
        &600,
        &None,
    );

    // Admin caps slippage at 100 bps: a user passing 500 bps (or more) is
    // capped to 100 and the 500 bps drop is rejected.
    f.bridge.set_slippage_threshold(&100);
    for max_slippage in [500u32, 600, 10_000] {
        let res = f.bridge.try_deposit(
            &user,
            &100,
            &f.token,
            &Bytes::new(&f.env),
            &FIXED_ONE_USD,
            &max_slippage,
            &None,
        );
        assert_eq!(res, Err(Ok(Error::SlippageTooHigh)));
    }
}

#[test]
fn deposit_within_threshold_passes_and_caller_can_tighten() {
    let f = setup();
    use_oracle(&f, &f.env.register(Oracle50BpsDrop, ()));
    let user = Address::generate(&f.env);
    f.token_sac.mint(&user, &5_000);
    f.bridge.set_slippage_threshold(&100);

    // 50 bps drop, caller asks for 500 → capped to 100, still passes.
    f.bridge.deposit(
        &user,
        &100,
        &f.token,
        &Bytes::new(&f.env),
        &FIXED_ONE_USD,
        &500,
        &None,
    );
    // A caller tolerance tighter than the threshold still applies.
    let res = f.bridge.try_deposit(
        &user,
        &100,
        &f.token,
        &Bytes::new(&f.env),
        &FIXED_ONE_USD,
        &20,
        &None,
    );
    assert_eq!(res, Err(Ok(Error::SlippageTooHigh)));
}

#[test]
fn execute_withdrawal_caps_caller_slippage_at_admin_threshold() {
    let f = setup();
    f.bridge.set_oracle(&f.env.register(Oracle500BpsDrop, ()));
    let user = Address::generate(&f.env);
    f.token_sac.mint(&user, &5_000);
    deposit(&f, &user, 1_000, &f.token);
    let req = f
        .bridge
        .request_withdrawal(&user, &500, &f.token, &None, &0);

    f.bridge.set_slippage_threshold(&100);
    let res = f
        .bridge
        .try_execute_withdrawal(&req, &None, &FIXED_ONE_USD, &500, &0);
    assert_eq!(res, Err(Ok(Error::SlippageTooHigh)));

    // Disabling the threshold restores the caller's own tolerance.
    f.bridge.set_slippage_threshold(&0);
    f.bridge
        .execute_withdrawal(&req, &None, &FIXED_ONE_USD, &500, &0);
}

#[test]
fn set_operator_no_longer_reads_slippage_threshold() {
    let f = setup();
    f.bridge.set_slippage_threshold(&10_000);
    let op = Address::generate(&f.env);
    f.bridge.set_operator(&op, &true, &0);
    assert!(f.bridge.is_operator(&op));
}

// ── #1403: per-operator daily limit on withdraw ─────────────────────────

fn setup_operator<'a>() -> (Fixture<'a>, Address) {
    let f = setup();
    let operator = Address::generate(&f.env);
    f.bridge.set_withdraw_operator(&operator);
    let user = Address::generate(&f.env);
    f.token_sac.mint(&user, &10_000);
    deposit(&f, &user, 5_000, &f.token);
    (f, operator)
}

#[test]
fn operator_can_withdraw_exactly_up_to_limit() {
    let (f, op) = setup_operator();
    f.bridge.set_operator_daily_limit(&op, &150);
    let to = Address::generate(&f.env);

    f.bridge.withdraw(&op, &to, &100, &f.token);
    f.bridge.withdraw(&op, &to, &50, &f.token);
    assert_eq!(TokenClient::new(&f.env, &f.token).balance(&to), 150);
}

#[test]
fn operator_over_limit_is_rejected() {
    let (f, op) = setup_operator();
    f.bridge.set_operator_daily_limit(&op, &150);
    let to = Address::generate(&f.env);

    assert_eq!(
        f.bridge.try_withdraw(&op, &to, &151, &f.token),
        Err(Ok(Error::OperatorDailyLimitExceeded))
    );
    f.bridge.withdraw(&op, &to, &150, &f.token);
    assert_eq!(
        f.bridge.try_withdraw(&op, &to, &1, &f.token),
        Err(Ok(Error::OperatorDailyLimitExceeded))
    );
    assert_eq!(TokenClient::new(&f.env, &f.token).balance(&to), 150);
}

#[test]
fn operator_limit_resets_after_window() {
    let (f, op) = setup_operator();
    f.bridge.set_operator_daily_limit(&op, &150);
    let to = Address::generate(&f.env);

    f.bridge.withdraw(&op, &to, &150, &f.token);
    assert_eq!(
        f.bridge.try_withdraw(&op, &to, &1, &f.token),
        Err(Ok(Error::OperatorDailyLimitExceeded))
    );

    // Still inside the window one ledger before it closes.
    let start = f.env.ledger().sequence();
    f.env
        .ledger()
        .with_mut(|li| li.sequence_number = start + WINDOW_LEDGERS - 1);
    assert_eq!(
        f.bridge.try_withdraw(&op, &to, &1, &f.token),
        Err(Ok(Error::OperatorDailyLimitExceeded))
    );

    f.env
        .ledger()
        .with_mut(|li| li.sequence_number = start + WINDOW_LEDGERS);
    f.bridge.withdraw(&op, &to, &150, &f.token);
    assert_eq!(TokenClient::new(&f.env, &f.token).balance(&to), 300);
}

#[test]
fn admin_is_not_subject_to_operator_limit() {
    let (f, op) = setup_operator();
    f.bridge.set_operator_daily_limit(&op, &150);
    f.bridge.set_operator_daily_limit(&f.admin, &150);
    let to = Address::generate(&f.env);
    f.bridge.withdraw(&f.admin, &to, &1_000, &f.token);
}

#[test]
fn zero_limit_disables_and_negative_is_rejected() {
    let (f, op) = setup_operator();
    let to = Address::generate(&f.env);

    assert_eq!(
        f.bridge.try_set_operator_daily_limit(&op, &-1),
        Err(Ok(Error::InvalidAmount))
    );

    f.bridge.set_operator_daily_limit(&op, &100);
    assert_eq!(
        f.bridge.try_withdraw(&op, &to, &101, &f.token),
        Err(Ok(Error::OperatorDailyLimitExceeded))
    );
    f.bridge.set_operator_daily_limit(&op, &0);
    f.bridge.withdraw(&op, &to, &1_000, &f.token);
}

#[test]
fn set_operator_daily_limit_emits_event() {
    let (f, op) = setup_operator();
    f.bridge.set_operator_daily_limit(&op, &150);
    assert!(has_event(
        &f.env,
        &f.contract_id,
        "operator_daily_limit_set_event"
    ));
}
