# Invariant Testing Guide

This document describes the invariant-testing strategy used throughout the
FiatBridge Soroban contract. It is intended for contributors who are adding
new state-changing entry points, modifying accounting logic, or extending the
multisig governance flow.

---

## Why Invariants Matter

Smart contracts must hold *accounting* invariants — relationships between
on-chain storage and real token balances that, if broken, allow funds to be
drained, minted out of thin air, or double-spent. In a Soroban contract the
WASM runtime provides no implicit protection against a buggy `deposit` or
`withdraw` corrupting `total_deposited` / `total_withdrawn` bookkeeping; the
only guard is the code itself.

Invariant tests verify these relationships **after every relevant mutation**
rather than merely checking "the happy path works". They exist to catch the
kinds of regressions that unit tests miss: a reordering of arithmetic, a
missed guard, an off-by-one in a counter, or a forgetting to subtract
liabilities on a partial withdrawal.

---

## Core Accounting Invariants

The contract enforces three fundamental invariants in
`FiatBridge::check_invariants` (see `src/lib.rs`), called at the end of every
state-changing entry point that touches token accounting:

| # | Invariant | Enforced Where | Error |
|---|-----------|----------------|-------|
| 1 | `total_deposited >= total_withdrawn` | `check_invariants` | `Error::InternalError` |
| 2 | `net_deposited = total_deposited - total_withdrawn` must be `>= total_liabilities` | `check_invariants` | `Error::InternalError` |
| 3 | on-chain token balance `>= net_deposited` | `check_invariants` | `Error::InsufficientFunds` |

### 1. `total_deposited >= total_withdrawn`

The contract can never withdraw more than has been deposited across its whole
lifetime. A violation here means either a corrupt counter or an exploit that
lets funds leave without a matching deposit record.

### 2. `net_deposited >= total_liabilities`

`total_liabilities` tracks funds that users have *requested* to withdraw but
not yet received (the pending withdrawal queue). The aggregate outstanding
liability can never exceed the net amount actually held by the contract. A
violation here means the contract could theoretically pay out more than it
holds.

### 3. `balance >= net_deposited`

The real on-chain token balance must always be at least the net amount the
contract owes to depositors. A violation here — balance *less than*
`net_deposited` — indicates the contract's own tokens were spent on something
other than a tracked deposit/withdrawal (e.g. an untracked fee transfer or a
bug in `withdraw_fees`).

> **Note:** `check_invariants` calls `token_client.balance()` and compares
> against the `TokenConfig` stored in persistent storage. Because the
> comparison is `>=` (not `==`), untracked "extra" balance (e.g. accrued fees
> that have not yet been withdrawn) is explicitly allowed.

---

## Test Organisation

Invariant test modules live in `src/` alongside the contract code. A file in
`src/` is compiled only if `lib.rs` declares it with a `mod` line. An
undeclared file is never compiled, whatever attributes it carries, so its
tests never run.

### Registered invariant modules

Each of these is declared in `lib.rs` behind `#[cfg(test)]`:

| Module | Scope |
|--------|-------|
| `test_approve_multisig_action_invariants` | multisig approval list |
| `test_revoke_multisig_approval_invariants` | multisig approval revocation |
| `test_propose_multisig_action_invariants` | multisig proposal creation |
| `test_get_multisig_proposal_invariants` | read-only proposal accessor |
| `test_propose_upgrade_invariants` | governed upgrade proposal state |
| `test_execute_upgrade_invariants` | `execute_upgrade` rejection codes |
| `test_execute_upgrade_timelock_invariants` | upgrade timelock boundary and inertness |
| `test_request_withdrawal_invariants` | withdrawal-queue entry accounting |
| `test_execute_withdrawal_invariants` | withdrawal execution accounting |
| `test_cancel_withdrawal_invariants` | withdrawal cancellation and liability release |
| `test_reclaim_expired_withdrawal_invariants` | reclaiming expired withdrawal requests |
| `test_set_withdrawal_expiry_invariants` | withdrawal expiry configuration |
| `test_get_withdrawal_request_invariants` | read-only withdrawal request accessor |
| `test_get_next_priority_withdrawal_invariants` | read-only risk-tier scheduler |
| `test_set_operator_invariants` | operator roster, cap and nonces |
| `test_is_denied_invariants` | read-only denylist lookup |
| `test_denylist_invariants` | `deny_address` / `remove_denied_address` and denylist enumeration |
| `test_token_allowlist_invariants` | per-token allowlist setters, deposit gate and enumeration |
| `test_set_fee_recipient_invariants` | fee recipient configuration |
| `test_reset_circuit_breaker_invariants` | manual circuit breaker reset |
| `test_set_circuit_breaker_threshold_invariants` | circuit breaker threshold configuration |
| `test_set_circuit_breaker_reset_window_invariants` | circuit breaker auto-reset window |
| `test_migrate_escrow_invariants` | escrow storage migration |
| `test_get_deploy_config_hash_invariants` | read-only deployment config hash |

`lib.rs` also registers other test modules that are not invariant suites,
such as `test`, `test_init_validation`, `test_heartbeat_batch` and
`test_withdraw_circuit_breaker`. Treat the `mod` lines at the end of
`lib.rs` as the source of truth.

### Unregistered files

Some `test_*.rs` files in `src/` are not declared in `lib.rs` and are
therefore not compiled. Among them are `test_deposit_invariants.rs`,
`test_pause_invariants.rs`, `test_withdraw_fees_invariants.rs`,
`test_execute_multisig_action_invariants.rs` and
`test_get_multisig_signers_invariants.rs`. The inner `#![cfg(test)]` some of
them carry does not change this: without a `mod` line the compiler never
reads the file. Registering them is tracked in issue #1380. Until that lands,
the suites described below for these files do not run in CI.

### Adding a new test module

1. Create `src/test_<entry_point>_invariants.rs`. Start it with a `//!` doc
   comment describing the invariants it asserts.
2. Declare it at the end of `lib.rs`:

   ```rust
   #[cfg(test)]
   mod test_<entry_point>_invariants;
   ```

   Without this line the file is silently ignored.
3. Leave out an inner `#![cfg(test)]`. The `#[cfg(test)]` on the `mod` line
   already gates the file, so a second one is redundant. Some older modules
   still carry one; it is harmless.
4. The crate is `no_std`. Add `extern crate std;` if the module uses `std`
   (for example `std::vec::Vec` or `proptest`).
5. Import the contract through the crate root, for example
   `use crate::{DataKey, Error, FiatBridge, FiatBridgeClient};`.
6. Run `cargo test <module_name>` and check that the new tests appear in the
   output. If they don't, the `mod` line is missing.

---

## What Each Suite Covers

### Deposit Invariants (`test_deposit_invariants.rs`, not yet registered)

Re-asserts all three core accounting invariants after:

- a single deposit,
- multiple deposits,
- a deposit after a withdrawal,
- deposits from multiple users,
- a deposit after a request-withdrawal (liabilities increase),
- zero-withdrawal scenarios.

### Pause/Unpause Invariants (`test_pause_invariants.rs`, not yet registered)

Verifies that pausing:

- blocks every state-changing entry point (`deposit`, `withdraw`,
  `request_withdrawal`, `execute_withdrawal`),
- preserves existing on-chain state (`balance`, `total_deposited`),
- does **not** affect read-only view functions,
- is idempotent (repeated `pause` / `unpause` calls are harmless),
- emits the expected events,
- survives a full pause → unpause → operate cycle without breaking
  accounting invariants.

### Fee Withdrawal Invariants (`test_withdraw_fees_invariants.rs`, not yet registered)

Ensures `withdraw_fees` — which moves *untracked* accrued fees out of the
contract — never eats into tracked `net_deposited`. Re-asserts invariants 1–3
after fee accrual followed by fee withdrawal.

### Multisig Invariants

The multisig files assert state-transition and access-control invariants:

- **`approve_multisig_action`**: appending exactly one approval, no duplicates,
  no mutation of immutable proposal fields, rejection leaves storage unchanged.
- **`revoke_multisig_approval`**: exact inverse of approval; rejects
  non-signers and leaves state unchanged on error.
- **`execute_multisig_action`** (not yet registered): one-way `executed` flag
  (no double execution), threshold gate, failure paths leave state untouched,
  accounting untouched.
- **`get_multisig_proposal`**: read-only purity, faithful reflection of writes,
  `None` for unknown ids without creating entries.
- **`get_multisig_signers`** (not yet registered): read-only accessor purity,
  empty vector on uninitialised contract.

### Withdrawal Queue Invariants

Three suites cover the queue end to end.

**`test_request_withdrawal_invariants.rs`** — the only entry point into the
queue. Re-asserts all three core accounting invariants after each accepted
request and pins down:

- liabilities move by exactly the requested amount and never past
  `net_deposited`,
- `request_id`s are allocated once, in order, and never recycled — including
  after a cancellation,
- the stored `WithdrawRequest` mirrors its inputs, with
  `unlock_ledger = queued_ledger + lock_period`,
- every rejection path rolls back wholesale. This matters especially here:
  the entry point writes the queue entry, bumps `next_request_id` and updates
  both queue lengths *before* it validates the token registry and available
  funds, so a `TokenNotWhitelisted` or `InsufficientFunds` rejection is the
  sharpest available test that failures leave no partial state.

**`test_get_next_priority_withdrawal_invariants.rs`** — the read-only risk-tier
scheduler:

- read-only purity (repeated calls are stable and mutate nothing),
- referential integrity: a returned id always names a live request,
- lowest occupied tier wins over insertion order; FIFO within that tier,
- cancelled requests are never handed back out,
- rejected and unauthorised mutations never shift the priority head.

Note the deliberate compute-budget bound the suite documents: the scan covers
only `min(next_request_id, 256)` tiers, so a request filed in a tier above
that window is invisible to the scheduler until the window widens.

**`test_set_operator_invariants.rs`** — the operator roster:

- `is_operator` agrees with the flag written, and no bystander's flag moves,
- the `operator_count` carried by `SetOperatorEvent` always equals the number
  of set flags and never exceeds `max_operators`,
- grant and revoke are exact inverses; re-activation never double-counts,
- nonces advance by exactly one on success and are untouched by every
  rejection, so a failure can never burn or skip a nonce,
- role-confusion guards (admin, contract address) and the cap rejection leave
  no flag, nonce or event behind.

### Denylist Invariants (`test_denylist_invariants.rs`)

- `is_denied` and `get_denied_addresses` agree after any sequence of deny and
  remove calls, with no duplicate entries (property test),
- `DeniedCount` grows only when a new address is denied,
- `deposit`, `withdraw` and `request_withdrawal` return `AddressDenied` for a
  denied address and succeed again after removal,
- `DenyAddressEvent` / `DenyRemovedEvent` fire once per real state change,
- non-admin callers are rejected and leave no trace.

### Token Allowlist Invariants (`test_token_allowlist_invariants.rs`)

- with a token's allowlist enabled, unlisted depositors get `NotAllowed`;
  add lets them in and remove blocks them again,
- one token's allowlist never affects another token's deposits,
- `get_token_allowlist` pages over live pairs only, with no duplicates,
- `get_token_allowlist_enabled` keeps one current entry per token however
  often it is toggled,
- non-admin callers are rejected and leave no trace.

### Upgrade Invariants (`test_propose_upgrade_invariants.rs`)

- `executable_after = current_ledger + delay` (default or configured),
- deadline computation saturates rather than wrapping,
- admin-only authorisation; non-admin leaves stored proposal untouched,
- re-proposing replaces the pending proposal wholesale,
- accounting/config surface is never disturbed.

### Upgrade Timelock Invariants (`test_execute_upgrade_timelock_invariants.rs`)

`test_execute_upgrade_invariants.rs` covers `execute_upgrade`'s two rejection
codes and the "no proposal, no state change" property. This suite takes the
timelock itself as its subject — the guard `sequence < executable_after` that
decides *when* a proposal becomes executable:

- the lock still holds at `executable_after - 1` and releases at exactly
  `executable_after`, for any configured delay,
- a rejected execution is inert: the pending proposal keeps its hash and
  deadline verbatim and the accounting surface is untouched, however many
  times it is retried,
- a cancelled proposal stays unexecutable even past its original deadline,
- re-proposing re-arms the lock, so an elapsed deadline cannot be reused to
  execute the replacement early.

The success path is deliberately out of scope here: a real `execute_upgrade`
calls `update_current_contract_wasm`, which the test host only accepts for an
uploaded hash. The boundary tests therefore assert that the call is no longer
refused *by the timelock*, rather than depending on the SDK's version-pinned
doctest WASM fixture. `test::test_execute_upgrade_after_delay_succeeds` covers
the full success path where that fixture is available.

---

## Property-Based vs. Example-Based

Most invariant tests are *example-based*: they construct a concrete scenario
and assert the invariant holds. Several modules (e.g. the multisig approval
suite, `test_cancel_withdrawal_invariants.rs` and
`test_denylist_invariants.rs`) also use **`proptest`** to sweep an input
space, such as signer counts and thresholds, or random sequences of deny and
remove calls. This checks that the invariant holds for a range of inputs
rather than a single hand-picked one.

When extending a property-based suite:

- keep the generated domains bounded to realistic operational ranges,
- assert the full set of invariants, not just one,
- mirror the setup helpers of the existing module.

See [docs/fuzz-test-boundary.md](../../docs/fuzz-test-boundary.md) for
recommended generation ranges.

---

## Writing an Invariant Test

When adding a new state-changing entry point, follow this pattern:

1. **Identify the invariants** it can affect. Accounting entry points (deposit,
   withdraw, fee withdrawal, execution) must re-assert the three core
   invariants. Governance/state entry points (pause, upgrade, multisig) must
   re-assert read-purity, immutability of unrelated state, and one-way flags.
2. **Create a dedicated `test_<entry_point>_invariants.rs`** (or extend an
   existing one) with a module-level `//!` doc comment describing the
   invariants asserted and any authorisation quirks, and **declare it in
   `lib.rs`** as described in [Adding a new test module](#adding-a-new-test-module).
3. **Reuse the setup helpers** (`setup_bridge`, `setup_multisig`) rather than
   duplicating registration/init logic.
4. **Assert, don't just exercise.** Every test name should end with the
   invariant it protects (`_maintains_*`, `_preserves_*`, `_is_one_way`, etc.)
   and assert a concrete relationship using `assert!` / `assert_eq!`.
5. **Cover failure paths.** Each entry point should have a test that a rejected
   call (bad auth, unknown id, wrong threshold, paused state) leaves storage
   byte-for-byte unchanged.
6. **Run the whole contract suite** before submitting:
   ```bash
   cargo test
   cargo clippy --all-targets --all-features -- -D warnings
   ```

---

## Checklist for New Invariant Tests

- [ ] Does the test assert a *relationship* (an invariant) and not just "no
      error"?
- [ ] Are all three core accounting invariants re-asserted where the entry
      point touches accounting?
- [ ] Is there a failure-path test proving rejected calls leave state
      unchanged?
- [ ] Is read-only purity asserted for view functions?
- [ ] Is the module declared with `#[cfg(test)] mod ...;` in `lib.rs`, and do
      its tests show up in `cargo test` output?
- [ ] Is the module-level doc comment updated with the invariants asserted?
- [ ] Do `cargo test` and `cargo clippy --all-targets --all-features --
      -D warnings` pass?
