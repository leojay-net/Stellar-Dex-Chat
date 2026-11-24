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
  │── set_upgrade_delay(delay)──▶│  stores UpgradeDelay
  │                            │
  │── propose_upgrade(hash) ──▶│  stores UpgradeProposal
  │                            │       executable_after = current_ledger + stored_delay
  │          (wait for timelock to elapse)
  │                            │
  │── execute_upgrade() ───────▶│  replaces WASM
  │                            │
```

Key rules:
- `set_upgrade_delay` must set `delay ≥ MIN_UPGRADE_DELAY` (1 000 ledgers); shorter delays are rejected with
  `Error::UpgradeDelayTooShort (607)`.
- `propose_upgrade` takes the WASM hash and a caller-declared `new_version` u32;
  the delay is read from stored `UpgradeDelay` value.
- `execute_upgrade` uses a **`>=`** check, so execution is possible once
  `current_ledger >= executable_after`.
- Only one proposal can be pending at a time; proposing again overwrites the previous one.

---

## Pre-Upgrade Checklist

Complete **every** item before proposing an upgrade.

### 1. Build and Verify the New WASM

```bash
# From the stellar-contracts directory.
# Builds for wasm32v1-none and emits the optimized contract artifact.
stellar contract build

# Compute the SHA-256 hash of the optimised WASM
WASM_FILE=target/wasm32v1-none/release/stellar_contracts.optimized.wasm
sha256sum "$WASM_FILE"
```

Record the hash — you will need it for `propose_upgrade`.

### 2. Upload the New WASM

Install the optimized WASM on the target network before proposing the upgrade.
Use the same source account and network settings as the subsequent invocations;
confirm that the hash returned by the CLI matches the local SHA-256 above.

```bash
stellar contract install \
  --wasm "$WASM_FILE" \
  --source-account "$ADMIN_SECRET" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url "$RPC_URL"
```

### 3. Review the Contract Diff

```bash
git diff HEAD~1 HEAD -- src/
```

Confirm that:
- No storage key renames that would orphan existing data.
- No removal of existing error codes relied upon by the frontend.
- New `withdraw_fees` error variants are appended to `ERROR_CODES.md`.
- New `withdraw_fees` events use the `EVENT_VERSION` topic prefix.
- The per-caller nonce migration for `withdraw_fees` described in `NONCE_REPLAY_PROTECTION.md` is included.
- The `new_version` argument to `propose_upgrade` must be ≥ the value returned by
  `get_contract_version`; a strictly lower value is rejected with
  `Error::DowngradeNotAllowed (608)`.
- Any storage layout changes ship with a migration path.

### 4. Run the Full Test Suite

```bash
cargo test
```

All tests must pass before proceeding.

### 5. Snapshot Current Contract State

Use the Stellar CLI (`stellar`) to record the current on-chain values that must survive the upgrade:

```bash
# Replace CONTRACT_ID, RPC_URL and NETWORK_PASSPHRASE with actual values.
# `stellar contract invoke` requires a source account: either pass
# `--source-account <identity|G...|S...>` (alias `--source`) or export
# STELLAR_ACCOUNT=<identity> once for the whole session.
# A custom `--rpc-url` also requires the passphrase explicitly (see STELLAR_NETWORK_PASSPHRASE);
# with the built-in network config, `--network futurenet` alone is enough.
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url $RPC_URL \
  -- get_upgrade_proposal

stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url $RPC_URL \
  -- get_contract_version

stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url $RPC_URL \
  -- get_escrow_storage_version
```

Save the output — compare it against post-upgrade values to confirm no state was lost.

### 6. Confirm No Active Pending Withdrawals at Risk

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url $RPC_URL \
  -- get_withdrawal_count   # if function exists; otherwise check indexer
```

Consider pausing the contract during the upgrade window if withdrawal volume is high:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- pause
```

---

## Upgrade Procedure

### Step 1 — Set Upgrade Delay (one-time)

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- set_upgrade_delay \
  --ledgers 1000
```

Expected: no error; delay is stored for future upgrades.

### Step 1b — Propose the Upgrade

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- propose_upgrade \
  --new_wasm_hash $NEW_WASM_HASH_HEX \
  --new_version $NEW_VERSION_NUMBER
```

Expected: no error; event emitted on-chain.  `$NEW_VERSION_NUMBER` must be
≥ the value returned by `get_contract_version` (see Pre-Upgrade Checklist §5);
otherwise the transaction will fail with `Error::DowngradeNotAllowed (608)`.

Record:
- Proposal ledger: `current_ledger`
- Executable after: `current_ledger + delay`

### Step 2 — Monitor the Timelock Window

During the delay period:
- Watch for `cancel_upgrade` calls from the admin (would abort the upgrade).
- Monitor the indexer for any anomalous activity that would warrant cancellation.
- Confirm the proposal is still pending:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_upgrade_proposal
```

### Step 3 — Execute the Upgrade

Once `current_ledger >= executable_after`:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- execute_upgrade
```

Expected: `UpgradeExecutedEvent` emitted; contract WASM replaced.

---

## Post-Upgrade Verification

Run through the following checks immediately after `execute_upgrade` succeeds.

### 1. Confirm Upgrade Executed

```bash
# Confirm no upgrade is pending (returns None)
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_upgrade_proposal
```

Verify the returned value is `None`, indicating the proposal has been executed and cleared.

```bash
# Confirm the version was bumped to the proposed value
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_contract_version
```

### 2. Smoke-Test Read Functions

```bash
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_accrued_fees --token $TOKEN_ADDRESS
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_escrow_storage_version
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_upgrade_proposal
```

All read functions must return expected values without error.

### 3. Verify Pending Withdrawal Queue is Intact

Query a sample of known pending withdrawal request IDs and confirm their state matches
the pre-upgrade snapshot.

If the upgrade added per-caller nonce storage, confirm the migration step in
`NONCE_REPLAY_PROTECTION.md` completed and nonce reads return the expected values.

### 4. Unpause if Paused

```bash
stellar contract invoke \
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
# First, get the current nonce
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_upgrade_cancellation_nonce \
  --admin $ADMIN_ADDRESS

# Then cancel with the nonce
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account $ADMIN_SECRET \
  -- cancel_upgrade \
  --nonce $CURRENT_NONCE
```

Verify:

```bash
stellar contract invoke \
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
   stellar contract build
  WASM_FILE=target/wasm32v1-none/release/stellar_contracts.optimized.wasm
  sha256sum "$WASM_FILE"
   ```

2. **Pause the contract** (optional but recommended to prevent user funds being affected
   while the rollback timelock elapses):

   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --network $NETWORK \
     --source-account $ADMIN_SECRET \
     -- pause
   ```

3. **Propose the rollback upgrade** using the previous WASM hash:

   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --network $NETWORK \
     --source-account $ADMIN_SECRET \
     -- propose_upgrade \
     --new_wasm_hash $PREVIOUS_WASM_HASH_HEX
   ```

4. **Wait for the timelock** (`MIN_UPGRADE_DELAY` ledgers).

5. **Execute the rollback**:

   ```bash
   stellar contract invoke \
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
- Per-caller nonce keys created for `withdraw_fees` replay protection are not removed
  by rollback; they are ignored by the old WASM and will be reused by a future upgrade.
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
- [`NONCE_REPLAY_PROTECTION.md`](./NONCE_REPLAY_PROTECTION.md) — per-caller nonce schema and migration path
- [`BATCH_OPERATIONS.md`](./BATCH_OPERATIONS.md) — batch admin operations reference
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — initial Futurenet deployment guide
- [`FEE_ACCRUAL_ARCHITECTURE.md`](./FEE_ACCRUAL_ARCHITECTURE.md) — fee accrual events and structures
- [`NONCE_REPLAY_PROTECTION.md`](./NONCE_REPLAY_PROTECTION.md) — nonce and replay protection conventions
- [`ERROR_CODES.md`](./ERROR_CODES.md) — canonical list of contract error codes
