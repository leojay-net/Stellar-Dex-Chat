# Fee Accrual Vault Architecture Guide

## Overview

The fee accrual vault is a core component of the Stellar DEX Chat protocol that enables secure, auditable collection and management of protocol fees. The system combines on-chain token holdings with persistent ledger accounting to prevent double-spending, replay attacks, and ledger inconsistencies.

## Key Concepts

### Fee Vault
A **fee vault** is a per-token accounting structure that tracks accumulated fees for a specific token. The contract maintains:
- **Ledger Balance**: The recorded amount in persistent storage (`DataKey::FeeVault(token)`)
- **On-Chain Balance**: The actual token balance held by the contract

These may diverge due to external token transfers, liquidations, or other exceptional events. The reconciliation mechanism ensures consistency.

### Accrual
**Accruing a fee** means recording that tokens owed to the protocol have been received. This is a ledger operation—the tokens are already in the contract's balance; accrual simply records the internal accounting.

### Withdrawal
**Withdrawing fees** means transferring recorded fees from the contract to a designated recipient. The withdrawal process:
1. Verifies admin authorization
2. Reconciles the ledger with actual on-chain balance
3. Transfers tokens via the token contract
4. Updates the ledger
5. Updates replay-protection nonce (for single withdrawals)
6. Emits audit events

---

## Architecture Details

### Data Storage

#### Fee Vault Ledger
```
DataKey::FeeVault(token: Address) -> i128
```
Persistent storage for each token's accumulated fee balance. Initialized to 0 implicitly.

**Guarantees**:
- Never negative (validated at accrual)
- Reconciled before every withdrawal
- Atomic updates only via `deduct_fee_vault_ledger`

#### Withdrawal Nonce
```
DataKey::FeeWithdrawalNonce(admin: Address) -> u64
```
Per-admin replay-protection nonce for single-token fee withdrawals. Starts at 0.

**Guarantees**:
- Increments by 1 on each successful [`withdraw_fees`] call
- NOT incremented by [`withdraw_fees_batch`] (nonce = 0 in batch events)
- Used to enforce sequential ordering of individual withdrawal transactions

---

### Core Operations

#### 1. `accrue_fee(token, amount)`

**Purpose**: Record that fees have been received for a token.

**Access**: Admin only

**Preconditions**:
- Contract must be initialized (admin exists)
- Amount must be > 0

**Side Effects**:
- Increments `DataKey::FeeVault(token)` by amount
- Publishes `FeeAccruedEvent`

**Guarantees**:
- Vault balance only increases
- Failure before event emission (zero-amount check fails before publishing)
- Safe for repeated calls

**Example Usage**:
```rust
// During swap execution
contract.transfer_fee_tokens_to_self(token, fee_amount)?;
contract.accrue_fee(token, fee_amount)?;
```

---

#### 2. `get_accrued_fees(token) -> i128`

**Purpose**: Query the current ledger balance for a token.

**Access**: Public (read-only)

**Returns**: Ledger balance, or 0 if no vault exists.

**Notes**:
- Does NOT perform reconciliation
- Reflects the ledger state, not necessarily actual contract balance
- Use `reconcile_fee_vault` if you need the authoritative balance

---

#### 3. `get_fee_withdrawal_nonce(admin) -> u64`

**Purpose**: Query the current replay-protection nonce for an admin.

**Access**: Public (read-only)

**Returns**: The nonce to use in the next [`withdraw_fees`] call.

**Example Usage**:
```rust
let nonce = contract.get_fee_withdrawal_nonce(admin);
contract.withdraw_fees(to, token, amount, nonce)?;
// Next call must use nonce + 1
```

---

#### 4. `reconcile_fee_vault(token) -> i128`

**Purpose**: Synchronize the ledger with the actual on-chain token balance.

**Access**: Internal (private function)

**Preconditions**: None

**Returns**: The authoritative fee vault balance after reconciliation.

**Behavior**:

| Condition | Action | Return |
|-----------|--------|--------|
| Ledger = 0 or negative | Return 0 | 0 |
| Ledger ≤ Contract Balance | No correction needed | Ledger balance |
| Ledger > Contract Balance | Correct ledger down, emit event | Contract balance |

**Why Reconciliation Matters**:
- If someone directly transfers fee tokens out (e.g., `token.transfer(contract, recipient)`), the ledger still reflects those fees
- Reconciliation detects and corrects this mismatch
- Prevents the contract from attempting to send more fees than it physically holds

**Event Emitted on Correction**:
```rust
FeeVaultReconciledEvent {
    token,
    previous_balance,  // Old ledger value
    new_balance,       // New value (= contract balance)
}
```

---

#### 5. `deduct_fee_vault_ledger(token, vault_balance, amount) -> Result<i128, Error>`

**Purpose**: Update the ledger after a fee withdrawal.

**Access**: Internal (private function)

**Preconditions**:
- **CRITICAL**: Caller must have called `reconcile_fee_vault` first
- vault_balance should be the return value from reconciliation

**Behavior**:
- Validates vault_balance > 0
- Validates amount ≤ vault_balance
- Safely subtracts amount from vault_balance
- Updates persistent storage with remaining balance

**Returns**: The new vault balance (vault_balance - amount)

**Errors**:
- `NoFeesToWithdraw`: Vault is zero
- `FeeWithdrawalExceedsBalance`: Amount > vault_balance
- `Overflow`: Subtraction would overflow (should not occur)

---

#### 6. `withdraw_fees(to, token, amount, nonce) -> Result<(), Error>`

**Purpose**: Single-token fee withdrawal with replay protection.

**Access**: Admin only

**Parameters**:
- `to`: Recipient address
- `token`: Token to withdraw fees for
- `amount`: Exact amount to withdraw (must be > 0)
- `nonce`: Expected per-admin nonce (from `get_fee_withdrawal_nonce`)

**Execution Flow**:

```
1. Authenticate: Verify caller is admin
2. Validate: Check amount > 0
3. Nonce Check: Verify provided nonce matches expected nonce
4. Reconcile: Sync ledger with actual contract balance
5. Balance Checks: Verify vault has enough, contract has enough
6. Transfer: Move tokens to recipient via token contract
7. Update Ledger: Deduct amount from vault
8. Increment Nonce: Increment per-admin nonce for replay protection
9. Audit Event: Emit FeeWithdrawnEvent
```

**Side Effects**:
- Transfers tokens to recipient
- Updates fee vault ledger
- Increments per-admin nonce
- Emits `FeeWithdrawnEvent`

**Error Handling**:

| Error | Meaning | Recovery |
|-------|---------|----------|
| `NotInitialized` | Admin not set | Initialize contract first |
| `ZeroAmount` | amount ≤ 0 | Provide amount > 0 |
| `StaleNonce` | nonce < expected | Use `get_fee_withdrawal_nonce` to get current nonce |
| `InvalidNonce` | nonce > expected | Transaction out of order; retry with correct nonce |
| `NoFeesToWithdraw` | Vault balance = 0 | Accrue fees first via `accrue_fee` |
| `FeeWithdrawalExceedsBalance` | amount > vault | Reduce withdrawal amount |
| `InsufficientFunds` | Contract balance < amount | Likely reconciliation detected mismatch; retry |

---

#### 7. `withdraw_fees_batch(to, tokens) -> Result<(), Error>`

**Purpose**: Multi-token fee sweep without nonce consumption.

**Access**: Admin only

**Parameters**:
- `to`: Recipient address for all tokens
- `tokens`: Vector of token addresses to sweep

**Execution Flow**:

```
For each token in tokens:
  1. Reconcile vault balance
  2. If vault_balance ≤ 0: skip token
  3. Query contract's actual balance for token
  4. Determine sweep amount = min(vault_balance, contract_balance)
  5. If sweep_amount ≤ 0: skip token
  6. Transfer tokens to recipient
  7. Reset ledger to 0
  8. Emit FeeWithdrawnEvent (nonce = 0)
```

**Key Differences from `withdraw_fees`**:
- **No Nonce**: Batch withdrawals do NOT consume or increment the per-admin nonce
- **All-or-Nothing per Token**: Either the full vault is swept or the token is skipped
- **Reconciliation**: Handles discrepancies by capping to contract balance
- **Silent Skip**: Tokens with zero balance do not generate events

**Use Cases**:
- Periodic treasury sweeps across all supported tokens
- Emergency fee consolidation
- Maintenance operations

**Event Semantics**:
Each swept token emits an event with:
```rust
FeeWithdrawnEvent {
    admin,
    to,
    token,
    amount: sweep_amount,
    nonce: 0,  // Batch sweeps never have nonce
    remaining_fees: 0,  // Always zero after full sweep
}
```

---

## Security Considerations

### 1. Replay Attack Prevention

**Threat**: Admin issues withdrawal transaction T1. Attacker replays T1, extracting fees twice.

**Mitigation**: Per-admin nonce in `withdraw_fees`
- Each successful withdrawal increments nonce
- Retried transaction with old nonce fails (`StaleNonce`)
- Future transaction with skipped nonce fails (`InvalidNonce`)

**Nonce Semantics**:
```
Nonce 0: First withdrawal (nonce=0 → success → nonce becomes 1)
Nonce 1: Second withdrawal (nonce=1 → success → nonce becomes 2)
Nonce 0 (replay): Second attempt with old nonce fails (expected = 2)
```

**Batch Sweep Exemption**:
Batch withdrawals set `nonce=0` in events but do NOT consume the per-admin nonce. This allows batch sweeps to run independently without affecting sequential single-token withdrawal ordering.

### 2. Ledger-Balance Consistency

**Threat**: External token transfer causes ledger to exceed contract balance. Contract attempts to withdraw more than held.

**Mitigation**: Reconciliation before every withdrawal
```
reconcile_fee_vault(token):
  if vault_ledger > contract_balance:
    vault_ledger = contract_balance  // Correct downward
    emit FeeVaultReconciledEvent
```

**Audit Trail**: Events allow off-chain systems to detect and investigate reconciliations.

### 3. Admin Authorization

All fee operations require `admin.require_auth()`:
- `accrue_fee`: Admin only
- `withdraw_fees`: Admin only
- `withdraw_fees_batch`: Admin only

This ensures a single point of control and audit.

### 4. Integer Overflow/Underflow

**Mitigation**:
- `accrue_fee`: Uses unchecked addition (amount must be positive and reasonable)
- `deduct_fee_vault_ledger`: Uses `checked_sub` and returns `Overflow` error
- Nonce increment: Uses `checked_add` with `Overflow` check (effectively impossible at u64)

---

## Event Schema

### FeeAccruedEvent
```rust
pub struct FeeAccruedEvent {
    pub version: u32,
    pub token: Address,
    pub amount: i128,
}
```
Emitted by `accrue_fee`. Signals that protocol fees have been recorded.

### FeeVaultReconciledEvent
```rust
pub struct FeeVaultReconciledEvent {
    pub version: u32,
    pub token: Address,
    pub previous_balance: i128,  // Old ledger value
    pub new_balance: i128,        // New value after correction
}
```
Emitted by `reconcile_fee_vault` when a mismatch is detected. Audit signal for monitoring systems.

### FeeWithdrawnEvent
```rust
pub struct FeeWithdrawnEvent {
    pub version: u32,
    pub admin: Address,           // Who authorized the withdrawal
    pub to: Address,              // Who received the tokens
    pub token: Address,           // Which token
    pub amount: i128,             // How much
    pub nonce: u64,               // Nonce consumed (0 for batch)
    pub remaining_fees: i128,     // Vault balance after withdrawal
}
```
Emitted by `withdraw_fees` and `withdraw_fees_batch`. Full withdrawal context for auditability and indexing.

---

## Error Codes

| Code | Error | Meaning |
|------|-------|---------|
| 401 | `InsufficientFunds` | Contract does not hold enough tokens to complete withdrawal |
| 402 | `NoFeesToWithdraw` | Fee vault is zero; nothing to withdraw |
| 901 | `InvalidNonce` | Provided nonce > expected (transaction out of order) |
| 902 | `StaleNonce` | Provided nonce < expected (replay or old transaction) |

---

## Usage Patterns

### Pattern 1: Deposit Swap with Fee Accrual

```rust
// Admin executes swap with fee
pub fn swap_with_fee(to_token: Address, amount_in: i128, min_out: i128) -> Result<i128, Error> {
    let fee_amount = amount_in * FEE_BPS / 10000;
    
    // 1. Transfer full amount (including fee) from user
    transfer_in(amount_in)?;
    
    // 2. Perform swap (amount_in - fee_amount)
    let amount_out = internal_swap(amount_in - fee_amount, to_token)?;
    
    // 3. Accrue fee
    accrue_fee(in_token, fee_amount)?;
    
    Ok(amount_out)
}
```

### Pattern 2: Single-Token Fee Withdrawal

```rust
pub fn withdraw_usdc_fees(treasury: Address) -> Result<(), Error> {
    let nonce = contract.get_fee_withdrawal_nonce(admin);
    contract.withdraw_fees(
        treasury,
        usdc_token,
        1_000_000,  // 1M USDC
        nonce
    )?;
    Ok(())
}
```

### Pattern 3: Periodic Batch Sweep

```rust
pub fn monthly_fee_sweep(treasury: Address) -> Result<(), Error> {
    let tokens = vec![
        usdc_address,
        usdt_address,
        native_address,
        // ... other tokens
    ];
    contract.withdraw_fees_batch(treasury, tokens)?;
    Ok(())
}
```

### Pattern 4: Monitoring Fee Vault Health

```rust
pub fn check_vault_health(token: Address) -> Result<(), Error> {
    let ledger = contract.get_accrued_fees(token);
    let contract_balance = token_client.balance(contract);
    
    if ledger > contract_balance {
        // Ledger exceeds actual balance; likely external transfer occurred
        // Withdrawal will auto-reconcile, but log for investigation
        log_warning!("Fee vault ledger exceeds balance: {} > {}", ledger, contract_balance);
    }
    
    Ok(())
}
```

---

## Testing Strategy

### Unit Tests Covered

1. **Fee Accrual**
   - Successful accrual
   - Zero-amount rejection
   - Ledger growth over multiple calls

2. **Fee Queries**
   - Get accrued fees (empty vault)
   - Get accrued fees (populated vault)
   - Get fee withdrawal nonce

3. **Single Withdrawal**
   - Successful withdrawal with correct nonce
   - Stale nonce rejection
   - Invalid (future) nonce rejection
   - Insufficient vault balance
   - Insufficient contract balance

4. **Batch Withdrawal**
   - Multiple tokens swept
   - Partial balances handled correctly
   - Zero-balance tokens skipped
   - Reconciliation on vault overflow

5. **Reconciliation**
   - Ledger > contract balance triggers correction
   - Events emitted on correction
   - Vault remains accurate after correction

6. **Edge Cases**
   - Overflow handling
   - Zero amounts
   - Nonce overflow (u64 limit)
   - Empty fee vault

---

## Integration Checklist

- [ ] Fee accrual called at the right point in swap execution
- [ ] Admin address initialized and maintained
- [ ] Fee withdrawal nonce tracked per-admin
- [ ] Event indexers subscribed to all three event types
- [ ] Monitoring alerts configured for `FeeVaultReconciledEvent`
- [ ] Treasury/recipient address validated before withdrawal
- [ ] Audit logs capture all withdrawal attempts (success and failure)
- [ ] Frontend UI displays current fee balances via `get_accrued_fees`
- [ ] Admin dashboard shows withdrawal nonce and reconciliation history

---

## FAQ

**Q: Can fees be withdrawn as much as I want without a nonce?**
A: No. `withdraw_fees` (single-token) requires a matching nonce for replay protection. `withdraw_fees_batch` does not consume nonces but always sweeps the full vault per token.

**Q: What if the ledger says I have 1M fees but the contract only holds 500k?**
A: Reconciliation detects this during withdrawal and corrects the ledger down to 500k. An event is emitted. Investigate the discrepancy separately.

**Q: Can I accrue negative fees?**
A: No. `accrue_fee` rejects amount ≤ 0 with `ZeroAmount` error.

**Q: Do batch withdrawals increment the nonce?**
A: No. Batch withdrawals are nonce-exempt; the per-admin nonce remains unchanged. Each batch event has `nonce=0`.

**Q: What happens if I try to withdraw 0 fees?**
A: Both `withdraw_fees` and `withdraw_fees_batch` will fail. `withdraw_fees` rejects `amount <= 0`. `withdraw_fees_batch` will silently skip tokens with zero balance.

**Q: Can the fee vault go negative?**
A: No. `accrue_fee` only increments. `deduct_fee_vault_ledger` validates non-negative balances and rejects over-withdrawals. The ledger is never negative.

---

## Related Issues

- **#565**: Amount validation in fee operations
- **#687**: Replay protection nonce semantics
- **#695**: Replay protection nonce implementation
- **#702**: Fee accrual tests
- **#832**: Fee vault integration tests
- **#837**: Batch withdrawal behavior
- **#840**: Vault reconciliation edge cases
- **#881**: Fee withdrawal vault deduction

