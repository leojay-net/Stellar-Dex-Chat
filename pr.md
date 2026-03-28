# PR: Anti-sandwich delay between deposit and execute

## ✅ What this PR adds
- `stellar-contracts/src/lib.rs`: 
    - Added `AntiSandwichDelay` to `DataKey` and `ConfigSnapshot`.
    - Added `AntiSandwichDelayActive` (code 22) to `Error` enum.
    - Updated `deposit` to record `LastDeposit` ledger for all users and extended its TTL based on the configured delay.
    - Enforced `AntiSandwichDelayActive` in `execute_withdrawal` for the recipient address.
    - Added `set_anti_sandwich_delay` (admin) and `get_anti_sandwich_delay` (view).
    - Updated `get_config_snapshot` to include the new delay configuration.
- `stellar-contracts/src/test.rs`:
    - Added `test_anti_sandwich_delay` to verify blocking during delay and success after delay.
    - Refined existing tests by cleaning up unused imports and variables.

## 🎯 Acceptance criteria coverage
1. **Enforce minimum ledger delay between deposit and downstream execution.**
   - `execute_withdrawal` now checks `LastDeposit` ledger against the configured `AntiSandwichDelay`.
2. **Make delay configurable by admin.**
   - `set_anti_sandwich_delay` provides admin control over the delay period.
3. **Expose view for effective delay.**
   - `get_anti_sandwich_delay` and `get_config_snapshot` expose the setting.
4. **Add tests for pre/post-delay behavior.**
   - `test_anti_sandwich_delay` covers both immediate failure and deferred success scenarios.

## 🛠️ Technical details
- Uses `DataKey::LastDeposit(Address)` in `temporary` storage to track users' last deposit ledger.
- TTL for `LastDeposit` is dynamically extended in `deposit` to ensure the record persists for at least the configured `AntiSandwichDelay` or `CooldownLedgers` (max of both).
- Error code `22` (`AntiSandwichDelayActive`) specifically identifies the anti-sandwich block to distinguish it from the standard withdrawal lock period.

## 🧪 Validation
Run:
```bash
cd stellar-contracts
cargo test
```
**Test Results:**
- All 20 tests passed.
- `test::test_anti_sandwich_delay ... ok`
- `test::test_time_locked_withdrawal ... ok`
- `test::test_deposit_cooldown_blocks_rapid_second_deposit ... ok`

## 📸 Proof / attachment
- [X] Contract tests successfully ran and passed.

> Attach test log below:
>
> ```text
> running 20 tests
> test test::test_anti_sandwich_delay ... ok
> test test::test_deposit_and_withdraw ... ok
> test test::test_cancel_withdrawal ... ok
> test test::test_deposit_cooldown_is_per_address_only ... ok
> test test::test_get_config_snapshot ... ok
> test test::test_deposit_cooldown_blocks_rapid_second_deposit ... ok
> test test::test_double_init ... ok
> test test::test_insufficient_funds_withdraw ... ok
> test test::test_deposit_succeeds_after_cooldown_period ... ok
> test test::test_over_limit_deposit ... ok
> test test::test_last_deposit_record_expires_with_ttl ... ok
> test test::test_invariant_violation_insufficent_balance ... ok
> test test::test_set_limit ... ok
> test test::test_total_liabilities_tracking ... ok
> test test::test_transfer_admin ... ok
> test test::test_per_user_deposit_tracking ... ok
> test test::test_view_functions ... ok
> test test::test_zero_amount_deposit ... ok
> test test::test_time_locked_withdrawal ... ok
> test test::test_total_withdrawn_tracking ... ok
>
> test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.24s
> ```
