use crate::{DataKey, Error, FiatBridge, FiatBridgeClient, ESCROW_STORAGE_VERSION};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (
    soroban_sdk::token::Client<'a>,
    soroban_sdk::token::StellarAssetClient<'a>,
) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        soroban_sdk::token::Client::new(env, &contract_address.address()),
        soroban_sdk::token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

fn setup_bridge(
    env: &Env,
) -> (
    FiatBridgeClient<'_>,
    Address,
    Address,
    soroban_sdk::token::StellarAssetClient<'_>,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin) = create_token_contract(env, &admin);
    let token_addr = token_client.address.clone();

    let contract_id = env.register(FiatBridge, ());
    let bridge = FiatBridgeClient::new(env, &contract_id);

    bridge.init(
        &admin,
        &token_addr,
        &1_000_000,
        &100,
        &soroban_sdk::vec![env, admin.clone()],
        &1,
        &0,
    );

    (bridge, admin, token_addr, token_admin)
}

#[test]
fn test_migrate_escrow_invariants() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    token_admin.mint(&user1, &500);
    token_admin.mint(&user2, &1000);

    let deposit1_amount = 100i128;
    let deposit2_amount = 250i128;
    let deposit3_amount = 350i128;

    bridge.deposit(
        &user1,
        &deposit1_amount,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.deposit(
        &user2,
        &deposit2_amount,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );
    bridge.deposit(
        &user1,
        &deposit3_amount,
        &token_addr,
        &Bytes::new(&env),
        &0,
        &0,
        &None,
    );

    // Total receipts = 3

    // batch_size = 0
    let migrated_zero = bridge.migrate_escrow(&0);
    assert_eq!(migrated_zero, 0);
    assert_eq!(bridge.get_migration_cursor(), 0);

    // exact-fit batches (batch size 1)
    let migrated_one = bridge.migrate_escrow(&1);
    assert_eq!(migrated_one, 1);
    assert_eq!(bridge.get_migration_cursor(), 1);

    // check version bump has NOT occurred yet
    let version: u32 = env.as_contract(&bridge.address, || {
        env.storage()
            .instance()
            .get(&DataKey::EscrowStorageVersion)
            .unwrap_or(0)
    });
    assert_ne!(version, ESCROW_STORAGE_VERSION);

    // resumable migration (batch size 2 to finish the 3 items)
    let migrated_two = bridge.migrate_escrow(&2);
    assert_eq!(migrated_two, 2);
    assert_eq!(bridge.get_migration_cursor(), 3);

    // confirm version bump occurred exactly when cursor == ReceiptCounter
    let version_after: u32 = env.as_contract(&bridge.address, || {
        env.storage()
            .instance()
            .get(&DataKey::EscrowStorageVersion)
            .unwrap_or(0)
    });
    assert_eq!(version_after, ESCROW_STORAGE_VERSION);

    // MigrationAlreadyComplete on subsequent call
    let err = bridge.try_migrate_escrow(&1);
    assert_eq!(err, Err(Ok(Error::MigrationAlreadyComplete)));

    // conservation check: sum of migrated == sum of receipts
    let escrow0 = bridge.get_escrow_record(&0).unwrap();
    let escrow1 = bridge.get_escrow_record(&1).unwrap();
    let escrow2 = bridge.get_escrow_record(&2).unwrap();

    assert_eq!(escrow0.amount, deposit1_amount);
    assert_eq!(escrow1.amount, deposit2_amount);
    assert_eq!(escrow2.amount, deposit3_amount);

    assert_eq!(
        escrow0.amount + escrow1.amount + escrow2.amount,
        deposit1_amount + deposit2_amount + deposit3_amount
    );
}

#[test]
fn test_set_migration_cursor_bounds_and_interaction() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);

    // Initial state: receipt_counter == 0
    // Cursor 0 is accepted
    assert_eq!(bridge.try_set_migration_cursor(&0), Ok(Ok(())));
    assert_eq!(bridge.get_migration_cursor(), 0);

    // Cursor > receipt_counter (1 > 0) is rejected
    assert_eq!(
        bridge.try_set_migration_cursor(&1),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        bridge.try_set_migration_cursor(&u64::MAX),
        Err(Ok(Error::InvalidAmount))
    );

    // 3 deposits
    let user1 = Address::generate(&env);
    token_admin.mint(&user1, &500);
    bridge.deposit(&user1, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user1, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);
    bridge.deposit(&user1, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Now receipt_counter is 3. Cursor 4 is rejected (> 3)
    assert_eq!(
        bridge.try_set_migration_cursor(&4),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        bridge.try_set_migration_cursor(&u64::MAX),
        Err(Ok(Error::InvalidAmount))
    );

    // Set cursor to 1 (valid since 1 <= 3)
    assert_eq!(bridge.try_set_migration_cursor(&1), Ok(Ok(())));
    let stored_cursor = bridge.get_migration_cursor();
    assert_eq!(stored_cursor, 1);

    // Because cursor is 1, it will skip index 0
    let migrated = bridge.migrate_escrow(&5);
    assert_eq!(migrated, 2); // only indices 1 and 2 migrated
    assert_eq!(bridge.get_migration_cursor(), 3);

    // Rewinding cursor back to 0 is accepted for recovery
    assert_eq!(bridge.try_set_migration_cursor(&0), Ok(Ok(())));
    assert_eq!(bridge.get_migration_cursor(), 0);

    // Re-migrate all from 0
    let re_migrated = bridge.migrate_escrow(&5);
    assert_eq!(re_migrated, 3);
    assert_eq!(bridge.get_migration_cursor(), 3);
}

#[test]
fn test_multi_token_deposit_migration() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, admin, token1_addr, token1_admin) = setup_bridge(&env);

    // Create a second token contract and register it in TokenRegistry
    let (token2_client, token2_admin) = create_token_contract(&env, &admin);
    let token2_addr = token2_client.address.clone();
    let config = crate::TokenConfig {
        limit: 1_000_000,
        daily_deposit_limit: 0,
        total_deposited: 0,
        total_withdrawn: 0,
        total_liabilities: 0,
    };
    env.as_contract(&bridge.address, || {
        env.storage()
            .persistent()
            .set(&DataKey::TokenRegistry(token2_addr.clone()), &config);
    });

    let user = Address::generate(&env);
    token1_admin.mint(&user, &1000);
    token2_admin.mint(&user, &1000);

    // Deposit token 1
    bridge.deposit(&user, &100, &token1_addr, &Bytes::new(&env), &0, &0, &None);
    // Deposit token 2
    bridge.deposit(&user, &250, &token2_addr, &Bytes::new(&env), &0, &0, &None);

    // Verify receipts store the real tokens
    let receipt0 = bridge.get_receipt_by_index(&0).unwrap();
    let receipt1 = bridge.get_receipt_by_index(&1).unwrap();
    assert_eq!(receipt0.token, token1_addr);
    assert_eq!(receipt0.amount, 100);
    assert_eq!(receipt1.token, token2_addr);
    assert_eq!(receipt1.amount, 250);

    // Run migration
    let migrated = bridge.migrate_escrow(&10);
    assert_eq!(migrated, 2);

    // Verify EscrowRecord preserves the distinct tokens
    let escrow0 = bridge.get_escrow_record(&0).unwrap();
    let escrow1 = bridge.get_escrow_record(&1).unwrap();
    assert_eq!(escrow0.token, token1_addr);
    assert_eq!(escrow0.amount, 100);
    assert_eq!(escrow1.token, token2_addr);
    assert_eq!(escrow1.amount, 250);
}

#[test]
fn test_deposit_after_migration_creates_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let (bridge, _admin, token_addr, token_admin) = setup_bridge(&env);

    let user = Address::generate(&env);
    token_admin.mint(&user, &5000);

    // Deposit 1 before migration
    bridge.deposit(&user, &100, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // Migrate: completes migration
    let migrated = bridge.migrate_escrow(&10);
    assert_eq!(migrated, 1);
    assert_eq!(bridge.get_escrow_storage_version(), ESCROW_STORAGE_VERSION);

    // Attempting another migration returns MigrationAlreadyComplete
    assert_eq!(
        bridge.try_migrate_escrow(&10),
        Err(Ok(Error::MigrationAlreadyComplete))
    );

    // Deposit 2 made AFTER migration
    bridge.deposit(&user, &300, &token_addr, &Bytes::new(&env), &0, &0, &None);

    // The deposit made after migration must have an escrow record immediately
    let escrow1 = bridge.get_escrow_record(&1).expect("post-migration deposit must have escrow record");
    assert_eq!(escrow1.depositor, user);
    assert_eq!(escrow1.token, token_addr);
    assert_eq!(escrow1.amount, 300);
    assert_eq!(escrow1.version, ESCROW_STORAGE_VERSION);
    assert!(!escrow1.migrated);

    // Migration cursor was automatically advanced
    assert_eq!(bridge.get_migration_cursor(), 2);

    // Subsequent migration attempt remains complete
    assert_eq!(
        bridge.try_migrate_escrow(&10),
        Err(Ok(Error::MigrationAlreadyComplete))
    );
}
