# Contract event reference

Every `#[contractevent]` struct in `src/lib.rs`. Each event carries a leading `version` field; data fields follow in declaration order.

The `events_doc` test in `src/lib.rs` fails if a struct is missing from this table.

| Event struct | Fields (in order) | Emitted by |
|---|---|---|
| `DeployHashEvent` | `version: u32`, `config_hash: BytesN<32>` | `init` |
| `DepositEvent` | `version: u32`, `from: Address`, `token: Address`, `amount: i128`, `receipt_id: BytesN<32>`, `by: Address`, `ledger: u32` | `deposit` |
| `ReceiptIssuedEvent` | `version: u32`, `receipt_id: BytesN<32>`, `memo_hash: Option<BytesN<32>>` | `deposit` |
| `WithdrawEvent` | `version: u32`, `to: Address`, `token: Address`, `amount: i128`, `by: Address`, `ledger: u32` | `withdraw` |
| `WithdrawalRequestedEvent` | `version: u32`, `to: Address`, `request_id: u64`, `memo_hash: Option<BytesN<32>>` | `request_withdrawal` |
| `WithdrawalExecutedEvent` | `version: u32`, `request_id: u64`, `to: Address`, `amount: i128`, `nonce: u64` | `execute_withdrawal` |
| `WithdrawalCancelledEvent` | `version: u32`, `request_id: u64` | `cancel_withdrawal` |
| `FeeAccruedEvent` | `version: u32`, `token: Address`, `amount: i128` | `accrue_fee` |
| `RefundEvent` | `version: u32`, `receipt_id: BytesN<32>`, `to: Address`, `amount: i128` | _helper / internal_ |
| `PausedEvent` | `version: u32`, `by: Address` | `pause` |
| `UnpausedEvent` | `version: u32`, `by: Address` | `unpause`, `batch_unpause` |
| `AdminTransferEvent` | `version: u32`, `old_admin: Address`, `new_admin: Address` | `transfer_admin`, `accept_admin` |
| `SetMinDepositEvent` | `version: u32`, `min: i128` | `set_min_deposit` |
| `SetLockPeriodEvent` | `version: u32`, `old: u32`, `new: u32` | `set_lock_period`, `execute_single_admin_op_internal` |
| `TokenRegisteredEvent` | `version: u32`, `token: Address`, `limit: i128`, `daily_limit: i128` | `register_token` |
| `OperatorDailyLimitSetEvent` | `version: u32`, `operator: Address`, `limit: i128` | `set_operator_daily_limit` |
| `SetLimitEvent` | `version: u32`, `token: Address`, `limit: i128`, `by: Address`, `ledger: u32` | `set_limit`, `execute_single_admin_op_internal` |
| `SlippageEvent` | `version: u32`, `slippage_bps: u32` | `check_slippage` |
| `SlippageThresholdSetEvent` | `version: u32`, `threshold_bps: u32` | `set_slippage_threshold`, `execute_single_admin_op_internal` |
| `FeeRecipientSetEvent` | `version: u32`, `old_recipient: Option<Address>`, `new_recipient: Option<Address>` | `set_fee_recipient`, `clear_fee_recipient` |
| `AdminActionQueuedEvent` | `version: u32`, `action_type: Symbol`, `action_id: u64`, `target_ledger: u32` | `queue_admin_action` |
| `AdminActionExecutedEvent` | `version: u32`, `action_id: u64` | `execute_admin_action`, `cancel_admin_action` |
| `SetOperatorEvent` | `version: u32`, `operator: Address`, `active: bool`, `previous_active: bool`, `operator_count: u32`, `by: Address`, `ledger: u32` | `set_operator` |
| `SetMaxOperatorsEvent` | `version: u32`, `previous: u32`, `max_operators: u32`, `active_operators: u32` | `set_max_operators` |
| `DenyAddressEvent` | `version: u32`, `address: Address` | `deny_address` |
| `HeartbeatEvent` | `version: u32`, `operator: Address`, `ledger: u32` | `execute_single_heartbeat` |
| `HeartbeatBatchEvent` | `version: u32`, `total_items: u32`, `success_count: u32`, `failure_count: u32`, `ledger: u32` | `heartbeat_batch` |
| `HeartbeatBatchFailEvent` | `version: u32`, `index: u32`, `total_items: u32` | `heartbeat_batch` |
| `NonceConsumedEvent` | `version: u32`, `scope: Symbol`, `owner: Address`, `new_nonce: u64` | `set_operator`, `validate_and_increment_nonce`, `validate_and_increment_set_limit_nonce`, `validate_and_increment_init_nonce`, `validate_and_increment_fee_withdrawal_nonce` |
| `OperatorPrunedEvent` | `version: u32`, `operator: Address`, `ledger: u32` | `prune_inactive_operators_internal` |
| `FeeWithdrawnEvent` | `version: u32`, `to: Address`, `amount: i128`, `token: Address` | `withdraw_fees`, `withdraw_fees_batch` |
| `FeeVaultReconciledEvent` | `version: u32`, `token: Address`, `vault_ledger: i128`, `on_chain_balance: i128` | `withdraw_fees` |
| `AdminRoleCheckEvent` | `version: u32`, `admin: Address`, `is_operator: bool` | `execute_batch_admin` |
| `RescueEvent` | `version: u32`, `token: Address`, `to: Address`, `amount: i128` | `rescue_token` |
| `QuotaSetEvent` | `version: u32`, `quota: i128` | `set_withdrawal_quota` |
| `QuotaResetEvent` | `version: u32`, `user: Address`, `window_start: u32` | `enforce_withdrawal_quota` |
| `WithdrawalQuotaConsumedEvent` | `version: u32`, `user: Address`, `amount: i128`, `total: i128` | `enforce_withdrawal_quota` |
| `MigrationEvent` | `version: u32`, `cursor: u64`, `migrated_count: u32` | `migrate_escrow` |
| `BatchFailEvent` | `version: u32`, `index: u32`, `total_ops: u32` | `execute_batch_admin` |
| `BatchOkEvent` | `version: u32`, `success_count: u32`, `failure_count: u32`, `total_ops: u32` | `execute_batch_admin` |
| `CircuitBreakerResetEvent` | `version: u32`, `ledger: u32` | `reset_circuit_breaker` |
| `CircuitBreakerTrippedEvent` | `version: u32`, `new_total: i128`, `threshold: i128` | `check_and_update_circuit_breaker` |
| `SetWithdrawOperatorEvent` | `version: u32`, `operator: Address` | `set_withdraw_operator` |
| `RemoveWithdrawOperatorEvent` | `version: u32` | `remove_withdraw_operator` |
| `DenyRemovedEvent` | `version: u32`, `address: Address` | `remove_denied_address` |
| `UpgradeCancelledEvent` | `version: u32`, `admin: Address`, `wasm_hash: BytesN<32>`, `nonce: u64` | `cancel_upgrade` |
| `UpgradeProposedEvent` | `version: u32`, `wasm_hash: BytesN<32>`, `executable_after: u32` | `propose_upgrade` |
| `UpgradeExecutedEvent` | `version: u32`, `wasm_hash: BytesN<32>` | `execute_upgrade` |
| `MultisigProposedEvent` | `version: u32`, `id: u64`, `proposer: Address` | `propose_multisig_action` |
| `MultisigApprovedEvent` | `version: u32`, `id: u64`, `signer: Address` | `approve_multisig_action` |
| `MultisigRevokedEvent` | `version: u32`, `id: u64`, `signer: Address` | `revoke_multisig_approval` |
| `MultisigExecutedEvent` | `version: u32`, `id: u64` | `execute_multisig_action` |
| `MultisigUpdatedEvent` | `version: u32`, `signers: Vec<Address>`, `threshold: u32` | `execute_single_admin_op_internal` |
| `EmergencyRecoverySetEvent` | `version: u32`, `recovery: Address`, `cap: i128`, `admin: Address` | `set_emergency_recovery` |
| `EmergencyRecoveryEvent` | `version: u32`, `recovery: Address`, `amount: i128`, `admin_last_active: u32`, `triggered_at: u32` | `trigger_emergency_recovery` |
| `InactivityThresholdSetEvent` | `version: u32`, `admin: Address`, `old_threshold: u32`, `new_threshold: u32` | `set_inactivity_threshold` |
| `WithdrawalExpiredEvent` | `version: u32`, `request_id: u64`, `to: Address`, `amount: i128`, `queued_ledger: u32` | `reclaim_expired_withdrawal` |
| `CircuitBreakerAutoResetEvent` | `version: u32`, `tripped_at: u32`, `reset_at: u32` | `check_and_update_circuit_breaker` |
| `LimitMaxCapSetEvent` | `version: u32`, `cap: i128` | `set_limit_max_cap` |
| `FeeWithdrawalBatchNonceEvent` | `version: u32`, `caller: Address`, `new_nonce: u64` | _helper / internal_ |
