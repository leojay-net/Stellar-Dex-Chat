# Contract Upgrade Runbook

Step-by-step procedure for upgrading the FiatBridge Soroban contract, including rollback
and emergency contacts.

---

## Table of Contents

1. [Overview](#overview)
2. [Upgrade Mechanism](#upgrade-mechanism)
3. [Pre-Upgrade Checklist](#pre-upgrade-checklist)
4. [Upgrade Procedure](#upgrade-procedure)
5. [Post-Upgrade Verification](#post-upgrade-verification)
6. [Rollback Procedure](#rollback-procedure)
7. [Emergency Contacts](#emergency-contacts)

---

## Overview

The FiatBridge contract uses a **two-phase commit** upgrade pattern with a mandatory
timelock (`MIN_UPGRADE_DELAY = 1 000 ledgers ≈ 83 minutes`).  No upgrade can take effect
immediately — there is always a window during which the proposal can be inspected and
cancelled.

All upgrade operations require the **contract admin** key.

---

## Upgrade Mechanism

```
Admin                       Contract
  │                            │
  │── propose_upgrade(hash, delay) ──▶│  stores UpgradeProposal
  │                            │       executable_after = current_ledger + delay
  │          (wait for timelock to elapse)
  │                            │
  │── execute_upgrade() ───────▶│  replaces WASM; version bumped
  │                            │
```

Key rules:
- `delay` must be ≥ `MIN_UPGRADE_DELAY` (1 000 ledgers); shorter delays are rejected with
  `Error::UpgradeDelayTooShort (607)`.
- `execute_upgrade` uses a **strict `>`** check, so execution is possible only once
  `current_ledger > executable_after` (one extra ledger of margin).
- `new_version` must be ≥ the currently stored version; downgrades are rejected with
  `Error::DowngradeNotAllowed (1201)`.
- Only one proposal can be pending at a time; proposing again overwrites the previous one.

---

## Pre-Upgrade Checklist

Complete **every** item before proposing an upgrade.

### 1. Build and Verify the New WASM

```bash
# From the stellar-contracts directory
cargo build --release --target wasm32-unknown-unknown

# Compute the SHA-256 hash of the optimised WASM
shasum -a 256 target/wasm32-unknown-unknown/release/fiat_bridge.wasm
```

Record the hash — you will need it for `propose_upgrade`.

### 2. Review the Contract Diff

```bash
git diff HEAD~1 HEAD -- src/
```

Confirm that:
- No storage key renames that would orphan existing data.
- No removal of existing error codes relied upon by the frontend.
- The `new_version` constant in `lib.rs` is greater than the currently deployed version.

### 3. Run the Full Test Suite

```bash
cargo test
```

All tests must pass before proceeding.

### 4. Snapshot Current Contract State

Use the Soroban CLI to record the current on-chain values that must survive the upgrade:

```bash
# Replace CONTRACT_ID and RPC_URL with actual values
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --rpc-url $RPC_URL \
  -- get_upgrade_proposal

soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --rpc-url $RPC_URL \
  -- get_escrow_storage_version
```

Save the output — compare it against post-upgrade values to confirm no state was lost.

### 5. Confirm No Active Pending Withdrawals at Risk

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --rpc-url $RPC_URL \
  -- get_withdrawal_count   # if function exists; otherwise check indexer
```

Consider pausing the contract during the upgrade window if withdrawal volume is high:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- pause
```

---

## Upgrade Procedure

### Step 1 — Propose the Upgrade

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- propose_upgrade \
  --wasm_hash $NEW_WASM_HASH_HEX \
  --delay 1000 \
  --new_version $NEW_VERSION_NUMBER
```

Expected: no error; `UpgradeProposedEvent` emitted on-chain.

Record:
- Proposal ledger: `current_ledger`
- Executable after: `current_ledger + delay`

### Step 2 — Monitor the Timelock Window

During the delay period:
- Watch for `cancel_upgrade` calls from the admin (would abort the upgrade).
- Monitor the indexer for any anomalous activity that would warrant cancellation.
- Confirm the proposal is still pending:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_upgrade_proposal
```

### Step 3 — Execute the Upgrade

Once `current_ledger > executable_after`:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- execute_upgrade
```

Expected: `UpgradeExecutedEvent` emitted; contract WASM replaced.

---

## Post-Upgrade Verification

Run through the following checks immediately after `execute_upgrade` succeeds.

### 1. Confirm Version Bump

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_contract_version   # or check the UpgradeExecutedEvent
```

The returned version must equal `NEW_VERSION_NUMBER`.

### 2. Smoke-Test Read Functions

```bash
soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_accrued_fees --token $TOKEN_ADDRESS
soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_escrow_storage_version
soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_upgrade_proposal
```

All read functions must return expected values without error.

### 3. Verify Pending Withdrawal Queue is Intact

Query a sample of known pending withdrawal request IDs and confirm their state matches
the pre-upgrade snapshot.

### 4. Unpause if Paused

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- unpause
```

### 5. Confirm Frontend Compatibility

Deploy and smoke-test the frontend against the upgraded contract.  Check for any ABI
breakage (changed argument names or types).

---

## Rollback Procedure

There is no on-chain "undo" for a Soroban WASM upgrade — once `execute_upgrade` succeeds,
the new WASM is live.  Rollback means **proposing a new upgrade** that points to the
previous WASM hash.

### Step 1 — Cancel a Pending Proposal (pre-execution)

If `execute_upgrade` has **not** yet been called, simply cancel the pending proposal:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- cancel_upgrade
```

Verify:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_upgrade_proposal   # must return None
```

### Step 2 — Roll Back a Live Upgrade (post-execution)

If the new WASM is already live and must be reverted:

1. **Locate the previous WASM hash.**  
   It is recorded in the `UpgradeExecutedEvent` emitted by the previous `execute_upgrade`
   call, or in your deployment artefact store.  It can also be retrieved from the Git tag
   of the previous release:

   ```bash
   git checkout <previous-release-tag>
   cargo build --release --target wasm32-unknown-unknown
   shasum -a 256 target/wasm32-unknown-unknown/release/fiat_bridge.wasm
   ```

2. **Pause the contract** (optional but recommended to prevent user funds being affected
   while the rollback timelock elapses):

   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID \
     --network $NETWORK \
     --source-account $ADMIN_SECRET \
     -- pause
   ```

3. **Propose the rollback upgrade** using the previous WASM hash.  
   Note: `new_version` for the rollback proposal must still be ≥ the version of the
   currently live contract (the one you are rolling back from) because `DowngradeNotAllowed`
   is enforced.  If the contract version field was incremented, you will need to bump
   `new_version` to the next integer rather than reverting to the old number:

   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID \
     --network $NETWORK \
     --source-account $ADMIN_SECRET \
     -- propose_upgrade \
     --wasm_hash $PREVIOUS_WASM_HASH_HEX \
     --delay 1000 \
     --new_version $ROLLBACK_VERSION_NUMBER
   ```

4. **Wait for the timelock** (`MIN_UPGRADE_DELAY` ledgers).

5. **Execute the rollback**:

   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID \
     --network $NETWORK \
     --source-account $ADMIN_SECRET \
     -- execute_upgrade
   ```

6. **Unpause** and run the post-upgrade verification checklist above.

### Rollback Caveats

- Any **storage schema changes** introduced by the bad WASM are not automatically
  reversed.  If the upgrade added new storage keys, they will remain after rollback
  but will be ignored by the old WASM.  If the upgrade *removed* keys that the old
  WASM reads, those reads will fall back to their default values.
- **Coordinate with the indexer team** — events emitted by the bad WASM between
  `execute_upgrade` and the rollback may need to be annotated or excluded from
  downstream data pipelines.

---

## Emergency Contacts

In the event of a failed upgrade or unexpected contract behaviour, escalate in this order:

| Role | Contact | When to reach out |
|------|---------|-------------------|
| Lead Smart-Contract Engineer | *(fill in name / handle)* | First point of contact for any contract issue |
| Protocol Security Lead | *(fill in name / handle)* | If funds are at risk or a vulnerability is suspected |
| Stellar Network Support | [Stellar Discord #soroban-dev](https://discord.gg/stellardev) | Network-level issues, RPC outages |
| Paystack Support | [Paystack Support Portal](https://paystack.com/support) | Payout failures on the fiat side |

> **Note:** Replace the placeholder contact fields above with your team's actual names,
> Slack handles, or email addresses before using this runbook in production.

---

## Related Documentation

- [`VERSION_MIGRATION.md`](./VERSION_MIGRATION.md) — upgrade mechanism deep-dive and event schema
- [`BATCH_OPERATIONS.md`](./BATCH_OPERATIONS.md) — batch admin operations reference
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — initial Futurenet deployment guide
