# Stellar Contracts

This directory contains the Soroban smart contracts for the Stellar DEX Chat application.

## Contracts

| Contract | Description |
|----------|-------------|
| [FiatBridge](./FIAT_BRIDGE_README.md) | Deposit receipt system, withdrawal queue, oracle-based fiat caps, and timelock admin |

---

## Architecture Diagram

The diagram below shows the complete **FiatBridge** flow: from a user deposit through receipt issuance, withdrawal queue, and admin operations.

```mermaid
flowchart TD
    subgraph USER["User Path"]
        U([User]) -->|"deposit(from, amount, token, ref)"| V[Validate:\ncooldown · allowlist\ntoken whitelist · amount & fiat limits]
        V -->|pass| TR[Transfer tokens\nfrom → contract]
        TR --> RC[Issue Receipt\n+ increment ReceiptCounter]
        RC --> EV[Emit events:\ndeposit · rcpt_issd]
    end

    subgraph WITHDRAW["Withdrawal Queue"]
        AW([Admin]) -->|"request_withdrawal(to, amount, token)"| RW[WithdrawRequest\nunlock_ledger = now + LockPeriod]
        RW --> WQ[(WithdrawQueue\n storage)]
        WQ -->|"execute_withdrawal(id, partial?)"| CK{ledger ≥\nunlock_ledger?}
        CK -->|No| WL[❌ WithdrawalLocked]
        CK -->|Yes| EW[Transfer tokens\ncontract → recipient]
    end

    subgraph ADMIN["Admin Path"]
        direction TB
        AA([Admin]) -->|"transfer_admin / set_*"| TL[queue_admin_action\nmin delay 48 h]
        TL --> QA[(QueuedAdminAction)]
        QA -->|execute_admin_action| TC{ledger >\ntarget_ledger?}
        TC -->|No| ANR[❌ ActionNotReady]
        TC -->|Yes| EA[Execute action\nRecord LastAdminActionLedger]

        AA -->|set_oracle\nset_fiat_limit| OR[(Oracle\n+ FiatLimit\n storage)]
        AA -->|"withdraw(to, amount, token)"| FWD[Immediate transfer\ncontract → to]
    end

    RC -.->|ReceiptCounter| AW
    OR -.->|validate_fiat_limit| V
```

> **Admin path detail:** `set_operator` and privileged mutations go through `queue_admin_action` with a ≥ 48-hour (`MIN_TIMELOCK_DELAY = 34_560 ledgers`) delay before `execute_admin_action` can be called. Fee accrual (`accrue_fee`) and fee withdrawal (`withdraw_fees`) map to `set_fiat_limit` / `withdraw` respectively.

---

## Development

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Test
cargo test

# Deploy (Testnet)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_contracts.wasm \
  --network testnet
```

See [FIAT_BRIDGE_README.md](./FIAT_BRIDGE_README.md) for full API reference and error code documentation.
