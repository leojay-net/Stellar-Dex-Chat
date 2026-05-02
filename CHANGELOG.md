# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **Event schema versioning (#275):** Every `env.events().publish()` call in the Fiat Bridge contract now includes `EVENT_VERSION` (currently `1`, a `u32`) as the first topic element. Off-chain indexers can use this field to detect breaking schema changes and handle migrations gracefully.
  - Affected events: `deploy_hash`, `deposit`, `rcpt_issd`, `withdraw`, `req_withdr`, `paused`, `unpaused`, `slippage`, `admin_action_queued`, `admin_action_executed`, `deny_add`, `deny_rem`, `heartbeat`, `nonce_inc`, `fee_accrue`, `fee_wdrw`, `rescue`, `quota_set`, `quota_reset`, `migration`, `batch_fail`, `batch_ok`, `cb_reset`, `cbtripped`.
  - Updated existing `test_withdrawal_quota_resets_after_window` assertion to match the new topic order.
  - Added unit tests (`test_event_version_deposit`, `test_event_version_request_withdrawal`, `test_event_version_deny_add_remove`) asserting that `EVENT_VERSION` is the first topic for bridge-emitted events.
