# FiatBridge threat model

Scope: the `FiatBridge` Soroban contract in `src/lib.rs`. For reporting vulnerabilities see [SECURITY.md](../../../SECURITY.md); for emitted events see [EVENTS.md](EVENTS.md).

## Assets
- Tokens held by the contract (user deposits, accrued fees).
- Admin and operator authority (limits, pause, token registration, upgrades).
- Withdrawal requests and receipts (integrity of the accounting).

## Actors and trust assumptions
- **Admin** is trusted but can be compromised; sensitive changes go through `queue_admin_action` / `execute_admin_action` with a delay, and ownership moves with `transfer_admin` / `accept_admin`.
- **Operators** are semi-trusted, limited by daily limits and heartbeats (`heartbeat`, `prune_inactive_operators`).
- **Users** are untrusted.
- **Tokens** are assumed to follow the Stellar token interface; unregistered or non-allowlisted tokens are rejected (`register_token`, allowlist functions).

## Threats and mitigations
| Threat | Mitigation | Where |
|---|---|---|
| Compromised admin | Queued actions with delay and cancel window; two-step admin transfer; renounce is queued | `queue_admin_action`, `cancel_admin_action`, `transfer_admin`, `queue_renounce_admin` |
| Malicious or odd token | Token registration, per-token limits, optional allowlist, invariant check after transfers | `register_token`, `set_limit`, `check_invariants` |
| Replay of signed admin calls | Per-admin nonces consumed on use | `check_nonce`, `validate_and_increment_nonce`, `get_*_nonce` |
| Rounding / overflow | Checked arithmetic and limit caps | `math.rs`, `deposit`, `withdraw` |
| Griefing via request-queue growth | Cooldowns, lock period, expiry reclaim of stale requests | `set_cooldown`, `set_withdrawal_cooldown`, `reclaim_expired_withdrawal` |
| Sandwiching around rate changes | Anti-sandwich delay and slippage checks | `set_anti_sandwich_delay`, `check_slippage` |
| Bad actors | Deny list checked on deposit and withdrawal | `deny_address`, `remove_denied_address` |
| Incident response | Pause / unpause, circuit breaker | `pause`, `unpause`, `require_not_paused`, `require_circuit_breaker_clear` |

Tests for these live in `src/test_*.rs` (for example `test_denylist_invariants.rs`, `test_heartbeat_replay.rs`, `test_fee_withdrawal_nonce.rs`).

## Residual risks
- A fully compromised admin that waits out the action delay.
- Tokens that break the standard interface in ways `check_invariants` cannot see.
- Oracle correctness for fiat limits (`set_oracle`, `set_fiat_limit`).
