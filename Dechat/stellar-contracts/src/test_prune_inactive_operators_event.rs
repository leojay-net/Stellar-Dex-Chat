use crate::{Contract, ContractClient, EVENT_VERSION};
use soroban_sdk::{test::Env, Address, Symbol};

#[test]
fn test_prune_inactive_operators_event() {
    let env = Env::default();
    let contract_id = env.register_contract(None, Contract);
    let client = ContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin).unwrap();

    let operator = Address::generate(&env);
    client.add_operator(&operator, &100).unwrap();

    env.ledger().set_timestamp(2000);
    let pruned = client.prune_inactive_operators(&500).unwrap();
    assert_eq!(pruned, 1);

    let events = env.events().all();
    assert_eq!(events.len(), 1);
    let event = events.first().unwrap();

    assert_eq!(event.topics.len(), 3);
    let version: u32 = event.topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(version, EVENT_VERSION);
    let event_symbol: Symbol = event.topics.get(1).unwrap().try_into().unwrap();
    assert_eq!(event_symbol, Symbol::new(&env, "prune_inactive_operators"));
    let event_operator: Address = event.topics.get(2).unwrap().try_into().unwrap();
    assert_eq!(event_operator, operator);

    assert_eq!(event.data.len(), 1);
    let current_time: u64 = event.data.get(0).unwrap().try_into().unwrap();
    assert_eq!(current_time, 2000);
}