# Canonical Error Code Registry

This document defines the stable error codes emitted by the Fiat Bridge contract. Client applications and indexers should use these codes to provide meaningful feedback to users.

| Code        | Name                            | Description                                                           |
| ----------- | ------------------------------- | --------------------------------------------------------------------- |
| **101-199** | **Initialization & State**      |                                                                       |
| 101         | `NotInitialized`                | The contract has not been initialized.                                |
| 102         | `AlreadyInitialized`            | The contract has already been initialized.                            |
| 103         | `InternalError`                 | An internal invariant was violated.                                   |
| **201-299** | **Authorization & Access**      |                                                                       |
| 201         | `Unauthorized`                  | The caller is not authorized to perform this action.                  |
| 202         | `NotAllowed`                    | The action is disallowed (e.g. not on allowlist).                     |
| 203         | `NoPendingAdmin`                | There is no pending admin to accept.                                  |
| 204         | `InvalidRecipient`              | The recipient address is invalid for this operation.                  |
| 205         | `NotOperator`                   | The caller is not registered as an operator.                          |
| **301-399** | **Constraints & Limits**        |                                                                       |
| 301         | `ZeroAmount`                    | The provided amount must be greater than zero.                        |
| 302         | `ExceedsLimit`                  | The amount exceeds the configured token limit.                        |
| 303         | `DailyLimitExceeded`            | The user's per-token daily deposit accumulator has exceeded the configured limit. |
| 304         | `ExceedsFiatLimit`              | The user's daily fiat-equivalent volume limit has been exceeded.      |
| 305         | `ReferenceTooLong`              | The deposit reference string exceeds the maximum length.              |
| 306         | `CooldownActive`                | A security cooldown is currently active for this user.                |
| 307         | `AntiSandwichDelayActive`       | The anti-sandwich delay is active.                                    |
| 308         | `TokenNotWhitelisted`           | The specified token is not supported by the bridge.                   |
| 309         | `AddressDenied`                 | The address is on the denylist and cannot perform this action.        |
| 310         | `RescueForbidden`               | Rescue of this token is forbidden (protocol or whitelisted token).    |
| 319         | `LimitCapCannotBeLowered`       | The new limit max cap is below the current cap and cannot be lowered. |
| **401-499** | **Funds & Balances**            |                                                                       |
| 401         | `InsufficientFunds`             | The contract or user has insufficient balance.                        |
| 402         | `NoFeesToWithdraw`              | There are no accrued fees available to withdraw.                      |
| **501-599** | **Withdrawal Queue**            |                                                                       |
| 501         | `RequestNotFound`               | The specified withdrawal request ID does not exist.                   |
| 502         | `WithdrawalLocked`              | The withdrawal request is still within its lock period.               |
| **601-699** | **Governance & Timelock**       |                                                                       |
| 601         | `ActionNotQueued`               | The specified admin action ID does not exist.                         |
| 602         | `ActionNotReady`                | The admin action is still within its timelock period, or `queue_admin_action` was called with `delay < MIN_TIMELOCK_DELAY` (34,560 ledgers ≈ 48 h). |
| 603         | `InactivityThresholdNotReached` | The inactivity period required for emergency recovery has not passed. |
| 604         | `NoEmergencyRecoveryAddress`    | No emergency recovery address has been configured.                    |
| **701-799** | **External Services**           |                                                                       |
| 701         | `OracleNotSet`                  | No price oracle has been configured.                                  |
| 702         | `OraclePriceInvalid`            | The oracle returned an invalid or zero price.                         |
| 703         | `SlippageExceeded`              | The price slippage exceeds the maximum allowed threshold.             |
| **801-899** | **Quota & Migration**           |                                                                       |
| 801         | `WithdrawalQuotaExceeded`       | The user's daily withdrawal quota has been exceeded.                  |
| 802         | `MigrationAlreadyComplete`      | The escrow migration has already been completed.                      |
| 803         | `BatchOperationFailed`          | One or more operations in the batch failed.                           |
| **901-999** | **Replay Protection**           |                                                                       |
| 901         | `InvalidNonce`                  | The provided nonce is invalid (too high/future nonce).                |
| 902         | `StaleNonce`                    | The provided nonce has already been used (replay attempt).            |

## Operator cap changes (`set_max_operators`)

`set_max_operators` reuses existing codes and introduces no new variants:

| Code | Name             | Raised when                                                                 |
| ---- | ---------------- | --------------------------------------------------------------------------- |
| 101  | `NotInitialized` | The contract has no admin, so the call is refused before any state is read.  |
| 302  | `ExceedsLimit`   | The requested cap is below the current active operator count.                |

A cap of `0` is the "unlimited" sentinel and is always accepted.

Every accepted call emits `SetMaxOperatorsEvent { version, previous, max_operators, active_operators }`,
where `version` is `EVENT_VERSION` and `previous` is the cap in force before the
call (`0` when none had been configured). Rejected calls emit nothing and leave
`MaxOperators` untouched.

No storage layout change ships with this event: it is emitted from the existing
`DataKey::MaxOperators` write path and reads only keys that already exist, so no
migration is required.

## Operator role checks (`is_operator`)

`is_operator` is a lookup, not a state transition, and introduces no new error
variants: it returns a bare `bool` and cannot fail. An address that was never
registered, and an uninitialised contract, both answer `false`.

Every query emits `IsOperatorCheckedEvent { version, operator, result }`, where
`version` is `EVENT_VERSION`, `operator` is the address that was queried and
`result` is the answer returned. This mirrors `IsDeniedCheckedEvent`, the
equivalent audit record already emitted by `is_denied`, so both access-control
lookups leave the same kind of trail.

No storage layout change ships with this event: it reads only the existing
`DataKey::FeeVault(token)` key and writes nothing, so no migration is
required.

## Limit max cap bounds check (`set_limit_max_cap`)

`set_limit_max_cap` now prevents lowering the cap below its current value.
It introduces one new error variant:

| Code | Name                     | Raised when                                                    |
| ---- | ------------------------ | -------------------------------------------------------------- |
| 319  | `LimitCapCannotBeLowered` | The requested cap is below the currently configured max cap.   |

Every accepted call emits `LimitMaxCapSetEvent { version, cap }`, where
`version` is `EVENT_VERSION` and `cap` is the newly configured maximum.
Rejected calls emit nothing and leave `LimitMaxCap` untouched.

No storage layout change ships with this event: it writes to the existing
`DataKey::LimitMaxCap` key, so no migration is required. Existing deployments
where `LimitMaxCap` is unset default to `i128::MAX`; the first accepted call
with this change stores the chosen cap and subsequent calls enforce the
non-decreasing constraint.

## Operator role management (`set_operator`)

`set_operator` now requires a nonce parameter for replay protection, following
the same pattern as `heartbeat`. It reuses existing error codes:

| Code | Name             | Raised when                                                                 |
| ---- | ---------------- | --------------------------------------------------------------------------- |
| 901  | `InvalidNonce`   | The provided nonce is greater than the current expected nonce (future nonce). |
| 902  | `StaleNonce`     | The provided nonce is less than the current expected nonce (replay attempt). |

Every accepted call emits `SetOperatorEvent { version, operator, active }`,
where `version` is `EVENT_VERSION`. Rejected calls emit nothing and leave
storage untouched.

The nonce validation uses the existing `DataKey::OperatorNonce(Address)` storage
key and the existing `validate_and_increment_nonce` helper function, so no new
storage layout changes are required. The nonce is validated before any state
changes occur, ensuring that failed nonce validations do not modify operator
status.

## Fee vault queries (`get_accrued_fees`)

`get_accrued_fees` is a read-only view function that now emits an audit event
for query tracking. It introduces no new error variants:

Every query emits `FeeQueryEvent { version, token, amount }`, where `version` is
`EVENT_VERSION`, `token` is the address queried, and `amount` is the ledger
balance returned. This provides an audit trail for fee vault queries without
modifying any storage.

No storage layout change ships with this event: it reads only the existing
`DataKey::FeeVault(token)` key and writes nothing, so no migration is required.
