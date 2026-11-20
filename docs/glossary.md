# Glossary

Alphabetical definitions of project-specific terminology used in Stellar-Dex-Chat. Each entry
links to the implementation in this repository. Terms describe current behavior only.

See the [TypeScript SDK Examples](typescript-sdk-examples.md) for calling conventions and the
[Testing Guide](testing.md) for how contract and frontend code is verified.

## Anti-sandwich delay

**Anti-sandwich delay** — An admin-configured number of ledgers that must pass after a depositor's
last deposit before a withdrawal for that depositor can be executed; `0` disables the check.

In Stellar-Dex-Chat the value is stored under `DataKey::AntiSandwichDelay`, initialized to `0` in
`init`, and set by the admin-only
[`set_anti_sandwich_delay`](../Dechat/stellar-contracts/src/lib.rs#L2662) function (or the batch
admin operation `"set_sandwich"`). `deposit` only records `DataKey::LastDeposit`; the check is
enforced in [`execute_withdrawal`](../Dechat/stellar-contracts/src/lib.rs#L1927), which returns
`Error::AntiSandwichDelayActive` when the current ledger sequence is earlier than the recorded
deposit ledger plus the delay. See [`DataKey`](../Dechat/stellar-contracts/src/lib.rs#L967) and
the [slippage threshold guide](slippage-threshold.md) for related protections.

## Bridge

**Bridge** — The `FiatBridge` Soroban contract, the on-chain vault that holds bridged tokens and
enforces deposits, withdrawals, limits, oracle checks, and admin governance.

The contract is declared as [`pub struct FiatBridge`](../Dechat/stellar-contracts/src/lib.rs#L1065)
and initialized with an admin, a token, a limit, a minimum deposit, multisig signers, a threshold,
and a nonce in [`init`](../Dechat/stellar-contracts/src/lib.rs#L1102). The frontend identifies the
deployed instance with `NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT` and exposes it as
[`CONTRACT_ID`](../Dechat/dex_with_fiat_frontend/src/lib/stellarContract.ts#L19); bridge balances
and stats are read through `getContractBalance` and `useBridgeStats`. Do not confuse this with
`CCIPBridgeModal`, a frontend-only status/transfer modal that is not part of the on-chain bridge.
See [`FIAT_BRIDGE_README.md`](../Dechat/stellar-contracts/FIAT_BRIDGE_README.md).

## Escrow record

**Escrow record** — A versioned, persistent record of a depositor's escrowed position, stored as
the Rust type `EscrowRecord`, which replaces the older evictable `Receipt`.

[`EscrowRecord`](../Dechat/stellar-contracts/src/lib.rs#L282) contains `version`, `depositor`,
`token`, `amount` (in the token's smallest unit), `ledger`, and `migrated`. Records are created by
[`migrate_escrow`](../Dechat/stellar-contracts/src/lib.rs#L5038) from legacy receipts (`migrated:
true`) or directly by post-migration deposits (`migrated: false`), and are read by
[`get_escrow_record`](../Dechat/stellar-contracts/src/lib.rs#L5140). The current schema version is
`ESCROW_STORAGE_VERSION = 1`. See the [version migration
guide](../Dechat/stellar-contracts/docs/VERSION_MIGRATION.md).

## Operator heartbeat

**Operator heartbeat** — An authenticated liveness call by an active operator, which consumes that
operator's current nonce, stores the current ledger sequence, and publishes a `HeartbeatEvent`.

In Stellar-Dex-Chat, [`heartbeat`](../Dechat/stellar-contracts/src/lib.rs#L3405) requires the
circuit breaker to be clear, calls `operator.require_auth()`, verifies the operator is active, and
then records `DataKey::OperatorHeartbeat(operator)`. Reusing or skipping a nonce fails replay
protection. Operators can also submit several signals through
[`heartbeat_batch`](../Dechat/stellar-contracts/src/lib.rs#L3420). The recorded ledger is compared
with `set_inactivity_threshold` when
[`prune_inactive_operators`](../Dechat/stellar-contracts/src/lib.rs#L3519) runs. See
[`EVENTS.md`](../Dechat/stellar-contracts/docs/EVENTS.md) for the event schema.

## SAC

**SAC** — Stellar Asset Contract, the contract that represents an asset on Stellar; in this
project the term refers to the native XLM SAC address used by the bridge.

The frontend exposes this as `NEXT_PUBLIC_XLM_SAC_CONTRACT` (documented in
[`.env.example`](../Dechat/dex_with_fiat_frontend/.env.example#L26)) and exports it as
[`XLM_SAC_ID`](../Dechat/dex_with_fiat_frontend/src/lib/stellarContract.ts#L23), with a testnet
default. The contract itself uses a generic `token::Client` for transfers (for example in
[`deposit`](../Dechat/stellar-contracts/src/lib.rs#L1383)), so there is no SAC-specific branch in
the on-chain code. Do not confuse the current variable with the obsolete
`NEXT_PUBLIC_XLM_SAC_ID` name still present in some workflows.

## Stroops

**Stroops** — The smallest unit of a Stellar asset; for XLM, `1 XLM = 10,000,000 stroops` (`10^7`).

The frontend converts decimal XLM to integer stroops and back with
[`xlmToStroops` / `stroopsToXlm`](../Dechat/dex_with_fiat_frontend/src/lib/stroops.ts#L78) using
string parsing and `BigInt`; contract amounts such as `deposit(amount: i128)` and withdrawal
limits are also expressed in stroops of the relevant token (see
[`lib.rs`](../Dechat/stellar-contracts/src/lib.rs#L1264)). `FeeEstimate.minFee` is a raw stroops
string while the other fee fields are decimal XLM for display. See the [overflow prevention
guide](OVERFLOW_PREVENTION.md).

## WQ (Withdrawal Queue)

**WQ (Withdrawal Queue)** — The on-chain queue of pending timelocked `WithdrawRequest` records,
stored by request ID with global and per-risk-tier bookkeeping.

[`request_withdrawal`](../Dechat/stellar-contracts/src/lib.rs#L1736) enqueues a request and returns
its `u64` ID; the [`WithdrawRequest`](../Dechat/stellar-contracts/src/lib.rs#L178) struct holds the
destination, token, amount, unlock ledger, optional memo hash, queued ledger, and risk tier.
[`execute_withdrawal`](../Dechat/stellar-contracts/src/lib.rs#L1927) operates by `request_id`,
while `cancel_withdrawal` and `reclaim_expired_withdrawal` remove pending entries. Read-only
getters include `get_withdrawal_request`, [`get_wq_depth`](../Dechat/stellar-contracts/src/lib.rs#L4523),
`get_wq_oldest_queued_ledger`, and `get_wq_oldest_age_ledgers`; `get_next_priority_withdrawal`
returns the highest-priority ID without executing it. The frontend polls `get_wq_depth` through
[`getWithdrawalQueueDepth`](../Dechat/dex_with_fiat_frontend/src/lib/stellarContract.ts#L412).
`QueuedAdminAction` is a separate admin-action queue, not the WQ.
