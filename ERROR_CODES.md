# Canonical Error Code Registry

This document defines the stable error codes emitted by the Fiat Bridge contract. Client applications and indexers should use these codes to provide meaningful feedback to users.

| Code | Name | Description |
|------|------|-------------|
| **101-199** | **Initialization & State** | |
| 101 | `NotInitialized` | The contract has not been initialized. |
| 102 | `AlreadyInitialized` | The contract has already been initialized. |
| 103 | `InternalError` | An internal invariant was violated. |
| **201-299** | **Authorization & Access** | |
| 201 | `Unauthorized` | The caller is not authorized to perform this action. |
| 202 | `NotAllowed` | The action is disallowed (e.g. not on allowlist). |
| 203 | `NoPendingAdmin` | There is no pending admin to accept. |
| 204 | `InvalidRecipient` | The recipient address is invalid for this operation. |
| **301-399** | **Constraints & Limits** | |
| 301 | `ZeroAmount` | The provided amount must be greater than zero. |
| 302 | `ExceedsLimit` | The amount exceeds the configured token limit. |
| 303 | `DailyLimitExceeded` | The daily withdrawal limit for the contract has been exceeded. |
| 304 | `ExceedsFiatLimit` | The user's daily fiat-equivalent volume limit has been exceeded. |
| 305 | `ReferenceTooLong` | The deposit reference string exceeds the maximum length. |
| 306 | `CooldownActive` | A security cooldown is currently active for this user. |
| 307 | `AntiSandwichDelayActive` | The anti-sandwich delay is active. |
| 308 | `TokenNotWhitelisted` | The specified token is not supported by the bridge. |
| **401-499** | **Funds & Balances** | |
| 401 | `InsufficientFunds` | The contract or user has insufficient balance. |
| **501-599** | **Withdrawal Queue** | |
| 501 | `RequestNotFound` | The specified withdrawal request ID does not exist. |
| 502 | `WithdrawalLocked` | The withdrawal request is still within its lock period. |
| **601-699** | **Governance & Timelock** | |
| 601 | `ActionNotQueued` | The specified admin action ID does not exist. |
| 602 | `ActionNotReady` | The admin action is still within its timelock period. |
| 603 | `InactivityThresholdNotReached` | The inactivity period required for emergency recovery has not passed. |
| 604 | `NoEmergencyRecoveryAddress` | No emergency recovery address has been configured. |
| **701-799** | **External Services** | |
| 701 | `OracleNotSet` | No price oracle has been configured. |
| 702 | `OraclePriceInvalid` | The oracle returned an invalid or zero price. |
