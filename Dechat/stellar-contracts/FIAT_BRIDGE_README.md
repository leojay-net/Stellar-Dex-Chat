# FiatBridge Contract

A Soroban smart contract implementing a fiat-to-crypto bridge with deposit receipts, withdrawal queues, daily volume limits, oracle-based fiat caps, and a timelock admin system.

---

## Architecture Diagram

The diagram below illustrates the complete flow through the contract, split into the **user path** and the **admin path**.

```mermaid
flowchart TD
    subgraph USER["User Path"]
        U1([User]) -->|"deposit(from, amount, token, reference)"| D1[Validate:\ncooldown · allowlist\ntoken whitelist · limits]
        D1 -->|pass| D2[Transfer tokens → contract]
        D2 --> D3[Emit Receipt + ReceiptIndex]
        D3 --> D4[(Storage:\nReceipt\nReceiptCounter\nUserDeposited\nTokenRegistry)]
    end

    subgraph WITHDRAW["Withdrawal Queue Path"]
        W1([Admin]) -->|"request_withdrawal(to, amount, token)"| W2[Create WithdrawRequest\nwith unlock_ledger]
        W2 --> W3[(Storage:\nWithdrawQueue(id))]
        W3 -->|"execute_withdrawal(id, partial?)"| W4{ledger ≥\nunlock_ledger?}
        W4 -->|No| W5[❌ WithdrawalLocked]
        W4 -->|Yes| W6[Transfer tokens → recipient]
    end

    subgraph ADMIN["Admin Path"]
        A1([Admin]) -->|set_operator / transfer_admin| A2[queue_admin_action\nwith ≥48h delay]
        A2 --> A3[(QueuedAdminAction)]
        A3 -->|execute_admin_action| A4{ledger >\ntarget_ledger?}
        A4 -->|No| A5[❌ ActionNotReady]
        A4 -->|Yes| A6[Execute & record LastAdminActionLedger]

        A1 -->|accrue_fee| AF1[set_fiat_limit\nset_oracle]
        A1 -->|withdraw_fees| WF1["withdraw(to, amount, token)"]
    end

    D4 -.->|ReceiptCounter| W1
```

---

## Circuit Breaker

The FiatBridge uses a **global rolling withdrawal circuit breaker** as a last-resort safety stop for withdrawal flows.

### What it watches

- Every `withdraw`, `request_withdrawal`, and `execute_withdrawal` call contributes to a shared rolling withdrawal total.
- The total is tracked in `GlobalDailyWithdrawn { amount, window_start }`.
- The default evaluation window is 24 hours (`WINDOW_LEDGERS`).

### When it trips

- Admin configures the breaker with `set_circuit_breaker_threshold(threshold)`.
- A threshold of `0` disables the breaker entirely.
- If a withdrawal would push the rolling total **above** the configured threshold, that withdrawal is rejected and the contract marks the breaker as tripped.
- The contract emits `CircuitBreakerTrippedEvent { new_total, threshold }` and stores the trip ledger in `CircuitBreakerTrippedAt`.

### What gets blocked

While the breaker is active, the contract refuses high-sensitivity operations that would otherwise continue withdrawal processing, including:

- `withdraw`
- `request_withdrawal`
- `execute_withdrawal`
- `heartbeat`
- `get_receipt_by_index`
- selected admin mutations such as `set_limit`

### How reset works

- Admin can clear it manually with `reset_circuit_breaker()`.
- Admin can configure auto-reset behavior with `set_circuit_breaker_reset_window(ledgers)`.
- `0` means "use the default 48-hour window" (`CIRCUIT_BREAKER_RESET_LEDGERS`).
- `u32::MAX` disables auto-reset entirely.
- On auto-reset, the breaker clears and the rolling withdrawal window is restarted, and the contract emits `CircuitBreakerAutoResetEvent { tripped_at, reset_at }`.

### Operational guidance

- Use the breaker as a **system-wide safety rail**, not as a user-specific rate limiter.
- Keep the threshold high enough to tolerate normal batched withdrawals but low enough to catch runaway operator or automation behavior.
- If the breaker trips unexpectedly, inspect recent withdrawal and heartbeat activity before manually resetting it.
## Admin Authentication Architecture

Admin privileges in the FiatBridge are strictly tied to the on-chain state. The architecture ensures that no front-end spoofing or bypassed routing can escalate privileges.

1. **Root of Trust**: The admin address is established during `init` and stored directly in the contract's instance storage (`DataKey::Admin`).
2. **Authorization**: Any administrative operation (e.g., `withdraw`, `set_limit`) requires a cryptographic signature matching the stored admin address. This is enforced by `require_auth` at the Soroban SDK level.
3. **Frontend Integration**: The Next.js frontend fetches the true admin address by calling `get_admin()` directly on the smart contract before displaying admin UI components or authorizing admin routes. 

---

## Error Code Reference

All errors are returned as `Result<_, Error>` variants. The contract uses a flat numbering scheme starting at 1.

| Code | Variant | Series | Description | Returned By |
|------|---------|--------|-------------|-------------|
| 1 | `NotInitialized` | Initialization | Contract has not been initialized (no admin set) | `withdraw`, `request_withdrawal`, `cancel_withdrawal`, `set_limit`, `set_cooldown`, `set_lock_period`, `transfer_admin`, `set_oracle`, `set_fiat_limit`, `queue_admin_action`, `execute_admin_action`, all view fns |
| 103 | `InternalError` | Initialization | Internal contract error (e.g. integer overflow) | `deposit`, `request_withdrawal`, `execute_withdrawal` |
| 2 | `AlreadyInitialized` | Initialization | `init` was called on a contract already initialized | `init` |
| 3 | `Unauthorized` | Auth | Caller is not the contract admin | (reserved; auth enforced via `require_auth`) |
| 4 | `ZeroAmount` | Amount Validation | Amount is ≤ 0, or `init` called with `limit ≤ 0` | `init`, `deposit`, `withdraw`, `request_withdrawal`, `execute_withdrawal` |
| 5 | `ExceedsLimit` | Amount Validation | Deposit amount exceeds per-token deposit limit | `deposit` |
| 6 | `InsufficientFunds` | Amount Validation | Contract balance is too low to fulfill the withdrawal | `withdraw`, `execute_withdrawal` |
| 7 | `WithdrawalLocked` | Withdrawal | Withdrawal request has not yet reached its unlock ledger | `execute_withdrawal` |
| 8 | `RequestNotFound` | Withdrawal | No withdrawal request exists for the given ID | `execute_withdrawal`, `cancel_withdrawal` |
| 9 | `TokenNotWhitelisted` | Token | Token address has no entry in the token registry | `deposit`, `set_limit` |
| 10 | `ReferenceTooLong` | Input Validation | Reference bytes exceed `MAX_REFERENCE_LEN` (64 bytes) | `deposit` |
| 11 | `DailyLimitExceeded` | Rate Limiting | User's per-token daily deposit accumulator has exceeded the configured limit | `deposit` (via `enforce_daily_deposit_limit`) |
| 12 | `CooldownActive` | Rate Limiting | User deposited too recently; cooldown period has not elapsed | `deposit` |
| 13 | `NotAllowed` | Access Control | Allowlist is enabled and caller is not on it | `deposit` |
| 14 | `OracleNotSet` | Oracle | Oracle address is not configured, or oracle returned a non-positive price | `deposit` (via `validate_fiat_limit`) |
| 15 | `ExceedsFiatLimit` | Oracle | Deposit would push user's 24-hour USD volume above the fiat cap | `deposit` (via `validate_fiat_limit`) |
| 16 | `NoPendingAdmin` | Admin Transfer | `accept_admin` called but no pending admin was set | `accept_admin` |
| 17 | `ActionNotReady` | Timelock | Timelock delay is less than `MIN_TIMELOCK_DELAY`, or execution attempted before `target_ledger` | `queue_admin_action`, `execute_admin_action` |
| 18 | `ActionNotQueued` | Timelock | No queued admin action exists for the given ID | `execute_admin_action` |
| 19 | `NoEmergencyRecoveryAddress` | Emergency | Emergency recovery address has not been set | (reserved for emergency recovery flow) |
| 20 | `InactivityThresholdNotReached` | Emergency | Admin inactivity period has not yet elapsed | (reserved for inactivity-triggered recovery) |
| 21 | `InvalidRecipient` | Withdrawal | Recipient address failed validation | (reserved for future recipient checks) |

### Error Series Summary

| Series | Code Range | Domain |
|--------|-----------|--------|
| Initialization | 1–2 | Contract lifecycle |
| Auth | 3 | Authorization |
| Amount Validation | 4–6 | Amount checks |
| Withdrawal | 7–8 | Queue management |
| Token | 9 | Whitelist |
| Input Validation | 10 | Byte constraints |
| Rate Limiting | 11–12 | Deposit throttling |
| Access Control | 13 | Allowlist |
| Oracle | 14–15 | Price oracle / fiat limit |
| Admin Transfer | 16 | Two-step admin handover |
| Timelock | 17–18 | Admin action queue |
| Emergency | 19–20 | Inactivity recovery |
| Future / Reserved | 21 | Planned extensions |

---

## CI Doc-Check

A GitHub Actions step validates that the error table stays in sync with the contract source. Add the following to your CI workflow:

```yaml
- name: Check error code docs are up-to-date
  run: |
    # Extract error variant count from lib.rs
    CONTRACT_ERRORS=$(grep -c '= [0-9]\+,' stellar-contracts/src/lib.rs)
    # Extract row count in the error table (lines starting with | followed by a digit)
    DOC_ERRORS=$(grep -cP '^\| \d+' stellar-contracts/FIAT_BRIDGE_README.md)
    echo "Contract errors: $CONTRACT_ERRORS, Documented errors: $DOC_ERRORS"
    if [ "$CONTRACT_ERRORS" != "$DOC_ERRORS" ]; then
      echo "ERROR: Error code count mismatch. Update FIAT_BRIDGE_README.md"
      exit 1
    fi
```

---

## Public Functions

| Function | Auth | Description |
|----------|------|-------------|
| `init(admin, token, limit)` | — | Initialize the contract |
| `deposit(from, amount, token, reference)` | `from` | Deposit tokens and receive a receipt |
| `withdraw(to, amount, token)` | admin | Immediate admin withdrawal |
| `request_withdrawal(to, amount, token)` | admin | Queue a time-locked withdrawal |
| `execute_withdrawal(id, partial?)` | — | Execute a queued withdrawal after unlock |
| `cancel_withdrawal(id)` | admin | Cancel a queued withdrawal |
| `set_limit(token, limit)` | admin | Update per-token deposit limit |
| `set_limit_max_cap(max_cap)` | admin | Set the global ceiling for future per-token liability limits |
| `get_set_limit_max_cap()` | — | Read the current global per-token limit ceiling |
| `set_daily_deposit_limit(token, limit_per_day)` | admin | Set per-token 24-hour rolling-window deposit limit for users |
| `set_cooldown(ledgers)` | admin | Set per-user deposit cooldown |
| `transfer_admin(new_admin)` | admin | Initiate two-step admin transfer |
| `accept_admin()` | pending admin | Complete admin transfer |
| `set_operator(operator, active)` | admin | Grant or revoke operator role (with timelock role check) |
| `queue_renounce_admin()` | admin | Queue irreversible admin renounce under timelock |
| `execute_renounce_admin()` | admin | Complete admin renounce after timelock elapses |
| `set_oracle(oracle)` | admin | Set oracle contract address |
| `set_fiat_limit(limit_usd_cents)` | admin | Set daily USD fiat limit |
| `queue_admin_action(type, payload, delay)` | admin | Queue a timelocked admin action |
| `execute_admin_action(id)` | admin | Execute a matured admin action |
| `set_token_allowlist_enabled(token, enabled)` | admin | Enable/disable allowlist for a specific token |
| `add_token_allowlist(token, address)` | admin | Add address to token-specific allowlist |
| `remove_token_allowlist(token, address)` | admin | Remove address from token-specific allowlist |
| `get_daily_deposit_record(user)` | — | Get 24h fiat deposit volume for a user |

---

# FiatBridge Contract — Integrator Reference

## Receipt IDs

### Current Type: `BytesN<32>`

Receipt IDs are deterministic **32-byte SHA-256 hashes**, not sequential `u64` integers.

#### Derivation

The contract derives each receipt ID by hashing a struct that combines the
depositor address, token address, amount, memo hash, and a monotonically
increasing per-contract `ReceiptCounter`:

```rust
// DataKey::ReceiptCounter tracks the next counter value (u64)
// DataKey::ReceiptIndex(counter) maps counter → BytesN<32> receipt hash
// DataKey::Receipt(BytesN<32>) stores the full Receipt struct
```

#### Reading a receipt ID from the `rcpt_issd` event (TypeScript)

```ts
import { Contract, SorobanRpc, xdr } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// Fetch the transaction's result metadata and scan contract events
const txMeta = await server.getTransaction(txHash);

for (const event of txMeta.resultMetaXdr.v3().sorobanMeta()?.events() ?? []) {
  const topics = event.body().v0().topics();
  const eventName = topics[0].sym().toString(); // "rcpt_issd"

  if (eventName === "rcpt_issd") {
    // event data is a BytesN<32> — hex-encode it for storage / display
    const receiptIdBytes: Buffer = Buffer.from(
      event.body().v0().data().bytes()
    );
    const receiptIdHex = receiptIdBytes.toString("hex");
    console.log("Receipt ID:", receiptIdHex);
    // e.g. "a3f1c8...64d2" (64 hex chars = 32 bytes)
  }
}
```

### `ReceiptIndex` enumeration

The contract maintains a `ReceiptIndex(u64)` mapping so receipts can be
iterated by sequential position without knowing the hash in advance:

```ts
// Query receipt by index position (0-based)
const receiptHash: string = await contract.get_receipt_by_index({ index: 0n });

// Total number of receipts issued
const count: bigint = await contract.get_receipt_counter();
```

> Note: `get_receipt_by_index` distinguishes between an out-of-range index
> (`ReceiptIndexOutOfBounds`) and a stale or expired receipt reference
> (`ReceiptNotFound`). Queries also emit a `ReceiptQueryEvent` for
> off-chain auditability.

---

## Migration Notes for Integrators

### Upgrading from `u64` receipt IDs

Previous versions of this contract used a plain `u64` counter as the receipt
ID. If you stored receipt IDs from an older deployment, re-index them as
follows:

| Old field | New field | Notes |
|-----------|-----------|-------|
| `receipt_id: u64` | `receipt_id: BytesN<32>` | 32-byte SHA-256 hash |
| Direct equality check (`id == 5`) | Hash comparison or index lookup | Use `ReceiptIndex(5)` to map counter → hash |

#### Storage key changes

```
Before:  DataKey::Receipt(u64)
After:   DataKey::Receipt(BytesN<32>)
         DataKey::ReceiptIndex(u64)   ← new: counter → hash mapping
         DataKey::ReceiptCounter      ← new: next counter value
```

#### Event payload changes

```
Before:  rcpt_issd data = u64
After:   rcpt_issd data = BytesN<32>
```

Update any event indexers that cast the `rcpt_issd` data field to `u64` to
instead treat it as a 32-byte buffer and hex-encode it for storage.
