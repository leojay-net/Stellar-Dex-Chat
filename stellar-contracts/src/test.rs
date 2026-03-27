use soroban_sdk::testutils::Events;
extern crate alloc;
use alloc::format;

#[cfg(any(test, feature = "testutils"))]
mod tests {
    extern crate std;
    use super::*;
    use crate::{Error, FiatBridge, FiatBridgeClient, Receipt};
    use soroban_sdk::testutils::{Events as _, Ledger};
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Bytes, Env, Symbol, Vec,
    };

    // ── helpers ──────────────────────────────────────────────────────────

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

    mod mock_oracle {
        use soroban_sdk::{contract, contractimpl, Address, Env};
        #[contract] pub struct MockOracle;
        #[contractimpl] impl MockOracle {
            pub fn get_price(_env: Env, _token: Address) -> Option<i128> { Some(1_000_000) }
        }
    }

    fn setup_oracle(env: &Env) -> Address {
        env.register(mock_oracle::MockOracle, ())
    }

    // ── happy-path tests ──────────────────────────────────────────────────

    #[test]
    fn test_deposit_and_withdraw() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
        let user = Address::generate(&env);
        token_sac.mint(&user, &1_000);
        bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
        assert_eq!(token.balance(&user), 800);
        assert_eq!(token.balance(&contract_id), 200);
        let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
        bridge.execute_withdrawal(&req_id, &None);
        assert_eq!(token.balance(&user), 900);
        assert_eq!(token.balance(&contract_id), 100);
    }

    #[test]
    fn test_deposit_for_success() {
        let env = Env::default();
        env.mock_all_auths();
        let (_contract_id, bridge, _admin, token_addr, _, token_sac) = setup_bridge(&env, 500);
        let payer = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        token_sac.mint(&payer, &1000);
        let ref_bytes = Bytes::from_slice(&env, b"third_party_ref");
        let receipt_id = bridge.deposit_for(&payer, &beneficiary, &200, &token_addr, &ref_bytes);
        assert_eq!(bridge.get_balance(&token_addr), 200);
        assert_eq!(bridge.get_user_deposited(&beneficiary), 200);
        let receipt = bridge.get_receipt(&receipt_id).unwrap();
        assert_eq!(receipt.depositor, beneficiary);
        assert_eq!(receipt.amount, 200);
    }

    #[test]
    fn test_time_locked_withdrawal() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 500);
        let user = Address::generate(&env);
        token_sac.mint(&user, &1_000);
        bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
        bridge.set_lock_period(&100);
        let start_ledger = env.ledger().sequence();
        let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
        assert_eq!(bridge.try_execute_withdrawal(&req_id, &None), Err(Ok(Error::WithdrawalLocked)));
        env.ledger().with_mut(|li| li.sequence_number = start_ledger + 100);
        bridge.execute_withdrawal(&req_id, &None);
        assert_eq!(token.balance(&user), 900);
    }

    #[test]
    fn test_cancel_withdrawal() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 500);
        let user = Address::generate(&env);
        token_sac.mint(&user, &1_000);
        bridge.deposit(&user, &200, &token_addr, &Bytes::new(&env));
        let req_id = bridge.request_withdrawal(&user, &100, &token_addr);
        bridge.cancel_withdrawal(&req_id);
        assert_eq!(bridge.try_execute_withdrawal(&req_id, &None), Err(Ok(Error::RequestNotFound)));
    }

    #[test]
    fn test_transfer_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _admin, _, _, _) = setup_bridge(&env, 100);
        let new_admin = Address::generate(&env);
        bridge.transfer_admin(&new_admin);
        assert_eq!(bridge.get_pending_admin(), Some(new_admin.clone()));
        bridge.accept_admin();
        assert_eq!(bridge.get_admin(), new_admin);
    }

    #[test]
    fn test_cancel_admin_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, admin, _, _, _) = setup_bridge(&env, 100);
        let nominated = Address::generate(&env);
        bridge.transfer_admin(&nominated);
        bridge.cancel_admin_transfer();
        assert_eq!(bridge.get_pending_admin(), None);
        assert_eq!(bridge.get_admin(), admin);
    }

    #[test]
    fn test_set_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, token_addr, _, _) = setup_bridge(&env, 500);
        bridge.set_limit(&token_addr, &1000);
        assert_eq!(bridge.get_limit(), 1000);
    }

    #[test]
    fn test_cooldown_logic() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 1000);
        let user = Address::generate(&env);
        token_sac.mint(&user, &1_000);
        bridge.set_cooldown(&10);
        let start_ledger = env.ledger().sequence();
        bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env));
        let result = bridge.try_deposit(&user, &50, &token_addr, &Bytes::new(&env));
        assert_eq!(result, Err(Ok(Error::CooldownActive)));
        env.ledger().with_mut(|li| li.sequence_number = start_ledger + 10);
        bridge.deposit(&user, &50, &token_addr, &Bytes::new(&env));
        assert_eq!(bridge.get_user_deposited(&user), 150);
    }

    #[test]
    fn test_emergency_drain_success() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, bridge, admin, token_addr, token, token_sac) = setup_bridge(&env, 1000);
        let recipient = Address::generate(&env);
        token_sac.mint(&admin, &500);
        bridge.deposit(&admin, &500, &token_addr, &Bytes::new(&env));
        bridge.emergency_drain(&recipient);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(token.balance(&recipient), 500);
        assert_eq!(bridge.get_total_withdrawn(), 500);
    }

    #[test]
    fn test_oracle_fiat_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, bridge, _, token_addr, _, token_sac) = setup_bridge(&env, 10_000);
        let oracle_addr = setup_oracle(&env);
        bridge.set_oracle(&oracle_addr);
        bridge.set_fiat_limit(&500); // $5 limit
        let user = Address::generate(&env);
        token_sac.mint(&user, &100_000);

        // 100 tokens at $0.10 = $10 = 1,000 cents → over $5 (500 cents) limit
        let result = bridge.try_deposit(&user, &100, &token_addr, &Bytes::new(&env));
        assert_eq!(result, Err(Ok(Error::ExceedsFiatLimit)));
    }

    #[test]
    fn test_invariant_preservation_randomized() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, bridge, _, token_addr, token, token_sac) = setup_bridge(&env, 10_000);
        let user = Address::generate(&env);
        token_sac.mint(&user, &10_000);

        let mut total_deposited = 0;
        let mut total_withdrawn = 0;
        let actions = [(true, 1000), (true, 500), (false, 300), (true, 2000), (false, 1000)];

        for (is_deposit, amount) in actions {
            if is_deposit {
                bridge.deposit(&user, &amount, &token_addr, &Bytes::new(&env));
                total_deposited += amount;
            } else {
                bridge.withdraw(&user, &amount, &token_addr);
                total_withdrawn += amount;
            }
            assert_eq!(bridge.get_total_deposited(), total_deposited);
            assert_eq!(bridge.get_total_withdrawn(), total_withdrawn);
            assert_eq!(token.balance(&contract_id), total_deposited - total_withdrawn);
        }
    }
}

#[test]
fn test_get_config_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, bridge, admin, token_addr, _, _) = setup_bridge(&env, 1000);

    bridge.set_cooldown(&12);

    let oracle_addr = Address::generate(&env);
    bridge.set_oracle(&oracle_addr);

    let config = bridge.get_config_snapshot();
    assert_eq!(config.admin, admin);
    assert_eq!(config.token, token_addr);
    assert_eq!(config.cooldown_ledgers, 12);
    assert_eq!(config.fiat_limit, None);
    assert_eq!(config.oracle, Some(oracle_addr));
    assert_eq!(config.allowlist_enabled, false);
}
