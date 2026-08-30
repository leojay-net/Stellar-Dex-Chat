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

Invariant test modules live in `src/` alongside the contract code:

| File | Scope | Registration |
|------|-------|-------------|
| `test_deposit_invariants.rs` | deposit accounting invariants | standalone (`#![cfg(test)]`) |
| `test_pause_invariants.rs` | pause/unpause state transitions | standalone (`#![cfg(test)]`) |
| `test_withdraw_fees_invariants.rs` | fee withdrawal accounting | standalone (`#![cfg(test)]`) |
| `test_approve_multisig_action_invariants.rs` | multisig approval list | module in `lib.rs` |
| `test_revoke_multisig_approval_invariants.rs` | multisig approval revocation | module in `lib.rs` |
| `test_execute_multisig_action_invariants.rs` | multisig threshold/execution | module in `lib.rs` |
| `test_get_multisig_proposal_invariants.rs` | read-only proposal accessor | module in `lib.rs` |
| `test_get_multisig_signers_invariants.rs` | read-only signers accessor | module in `lib.rs` |
| `test_propose_upgrade_invariants.rs` | governed upgrade proposal state | module in `lib.rs` |
| `test_request_withdrawal_invariants.rs` | withdrawal-queue entry accounting | module in `lib.rs` |
| `test_get_next_priority_withdrawal_invariants.rs` | read-only risk-tier scheduler | module in `lib.rs` |
| `test_set_operator_invariants.rs` | operator roster, cap and nonces | module in `lib.rs` |
| `test_execute_upgrade_timelock_invariants.rs` | upgrade timelock boundary and inertness | module in `lib.rs` |

### Standalone vs. Module Registration

Two registration styles are in use:

- **Standalone files** (`test_deposit_invariants.rs`, `test_pause_invariants.rs`,
  `test_withdraw_fees_invariants.rs`) carry an inner `#![cfg(test)]` attribute
  and are compiled only as part of the test build. They import the contract via
  `use crate::{FiatBridge, FiatBridgeClient, ...}`.
- **Registered modules** (the multisig and upgrade files) are declared in
  `lib.rs` behind `#[cfg(test)]`. They deliberately **omit** the inner
  `#![cfg(test)]` to keep clippy's `duplicated_attributes` lint quiet.

When adding a new invariant test, follow the registration style of the closest
existing module and keep the convention consistent within the file.

---

## What Each Suit Covers

### Deposit Invariants (`test_deposit_invariants.rs`)

Re-asserts all three core accounting invariants after:

- a single deposit,
- multiple deposits,
- a deposit after a withdrawal,
- deposits from multiple users,
- a deposit after a request-withdrawal (liabilities increase),
- zero-withdrawal scenarios.

### Pause/Unpause Invariants (`test_pause_invariants.rs`)

Verifies that pausing:

- blocks every state-changing entry point (`deposit`, `withdraw`,
  `request_withdrawal`, `execute_withdrawal`),
- preserves existing on-chain state (`balance`, `total_deposited`),
- does **not** affect read-only view functions,
- is idempotent (repeated `pause` / `unpause` calls are harmless),
- emits the expected events,
- survives a full pause → unpause → operate cycle without breaking
  accounting invariants.

### Fee Withdrawal Invariants (`test_withdraw_fees_invariants.rs`)

Ensures `withdraw_fees` — which moves *untracked* accrued fees out of the
contract — never eats into tracked `net_deposited`. Re-asserts invariants 1–3
after fee accrual followed by fee withdrawal.

### Multisig Invariants

The multisig files assert state-transition and access-control invariants:

- **`approve_multisig_action`**: appending exactly one approval, no duplicates,
  no mutation of immutable proposal fields, rejection leaves storage unchanged.
- **`revoke_multisig_approval`**: exact inverse of approval; rejects
  non-signers and leaves state unchanged on error.
- **`execute_multisig_action`**: one-way `executed` flag (no double execution),
  threshold gate, failure paths leave state untouched, accounting untouched.
- **`get_multisig_proposal`**: read-only purity, faithful reflection of writes,
  `None` for unknown ids without creating entries.
- **`get_multisig_signers`**: read-only accessor purity, empty vector on
  uninitialised contract.

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
and assert the invariant holds. Several modules (e.g. the multisig
threshold/approval suites and `test_get_multisig_signers_invariants.rs`) also
use **`proptest`** to sweep the signer-count / threshold / approval-count input
space, guaranteeing the invariant holds for a range of configurations rather
than a single hand-picked one.

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
   invariants asserted and any authorisation quirks.
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
- [ ] Is the module registered consistently (standalone vs. `lib.rs` module)?
- [ ] Is the module-level doc comment updated with the invariants asserted?
- [ ] Do `cargo test` and `cargo clippy --all-targets --all-features --
      -D warnings` pass?
