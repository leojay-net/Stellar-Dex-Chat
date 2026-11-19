# TypeScript SDK Examples

This guide reflects the **current** `FiatBridge` contract API in
[`Dechat/stellar-contracts/src/lib.rs`](../Dechat/stellar-contracts/src/lib.rs) and the
TypeScript integration in
[`Dechat/dex_with_fiat_frontend/src/lib/stellarContract.ts`](../Dechat/dex_with_fiat_frontend/src/lib/stellarContract.ts).

There are no generated Soroban TypeScript bindings in this repository. The canonical TypeScript
entry point is the hand-written `stellarContract.ts` module, which builds contract operations with
`new Contract(CONTRACT_ID).call(...)` and `@stellar/stellar-sdk` ScVal helpers. Examples below use
that same library and transaction pattern. They were assembled by source inspection only; no
snippet was executed against Futurenet, testnet, or a local quickstart.

## Current contract API at a glance

| Area | Contract functions (current names) | Frontend TypeScript wrapper |
|------|------------------------------------|-----------------------------|
| Core | `deposit`, `withdraw`, `request_withdrawal`, `execute_withdrawal`, `cancel_withdrawal`, `reclaim_expired_withdrawal` | `simulateDeposit`, `depositToContract`, `simulateWithdraw`, `withdrawFromContract`, `getWithdrawalQueueDepth` (partial coverage only) |
| Tokens | `register_token`, `get_token_config`, `set_token_allowlist_enabled`, `add_token_allowlist`, `remove_token_allowlist`, `get_token_allowlist`, `get_token_allowlist_enabled` | None |
| Multisig | `propose_multisig_action`, `approve_multisig_action`, `revoke_multisig_approval`, `execute_multisig_action`, `get_multisig_proposal`, `get_multisig_signers`, `get_multisig_threshold` | None |
| Circuit breaker / pause | `pause`, `unpause`, `batch_unpause`, `set_circuit_breaker_threshold`, `set_circuit_breaker_reset_window`, `reset_circuit_breaker`, `is_circuit_breaker_tripped`, `get_config_snapshot` | None |
| Emergency recovery | `set_emergency_recovery`, `get_emergency_recovery_cap`, `get_emergency_recovery_address`, `trigger_emergency_recovery`, `set_inactivity_threshold`, `get_inactivity_threshold`, `get_last_admin_action_ledger` | None |
| Operators | `set_operator`, `heartbeat`, `heartbeat_batch`, `is_operator`, `get_operator_heartbeat`, `get_operator_nonce`, `prune_inactive_operators` | None |
| Denylist / migration / batch admin | `deny_address`, `remove_denied_address`, `is_denied`, `migrate_escrow`, `execute_batch_admin` | None |
| Read-only | `get_admin`, `get_limit`, `get_total_deposited`, `get_min_deposit`, `get_token`, `get_accrued_fees`, `get_config_snapshot`, WQ getters | `getAdmin`, `getBridgeLimit`, `getTotalDeposited`, `getAccruedFees`, `getWithdrawalQueueDepth` |

Functions without a TypeScript wrapper are **not** exported by `stellarContract.ts`. The snippets
for those functions are illustrations using the same `@stellar/stellar-sdk` primitives as the
checked-in module; they are not claims that a helper of that name exists in the repository.

## Prerequisites and imports

The frontend declares `@stellar/stellar-sdk` `^14.6.1` and `@stellar/freighter-api` `^6.0.1` in
[`package.json`](../Dechat/dex_with_fiat_frontend/package.json). `stellarContract.ts` imports:

```typescript
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';
```

It configures `RPC_URL` from `NEXT_PUBLIC_STELLAR_RPC_URL`, `CONTRACT_ID` from
`NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT`, `XLM_SAC_ID` from `NEXT_PUBLIC_XLM_SAC_CONTRACT`, and uses
`Networks.TESTNET` as `NETWORK_PASSPHRASE`. The exported `DUMMY_SOURCE` account is only for
simulating read-only calls. Copy values from your own environment rather than hard-coding the
testnet defaults in production code.

## Transaction pattern used by this repository

For any state-changing call, the checked-in SDK:

1. Creates `new Contract(CONTRACT_ID)` and `contract.call('<function_name>', ...scVals)`.
2. Fetches the source account, builds a `TransactionBuilder` with `BASE_FEE` and the network
   passphrase, adds the operation, and calls `.setTimeout(30)`.
3. Simulates with `server.simulateTransaction(tx)`, rejects `rpc.Api.isSimulationError(sim)`, and
   assembles with `rpc.assembleTransaction(tx, sim).build().toXDR()`.
4. Requests a signature through a callback typed `signTx: (xdr: string) => Promise<string>`.
5. Submits with `server.sendTransaction(tx)`, then polls `server.getTransaction(hash)` until it is
   no longer `NOT_FOUND`; failures throw `Transaction failed on-chain`.

The private helpers are `buildAndSimulate` and `submitAndWait`; `pollTransaction(hash, maxRetries
= 20)` is exported. The exported result types are:

```typescript
export interface FeeEstimate {
  minFee: string;   // raw stroops, as a string
  fee: number;      // decimal XLM for display
  baseFee: number;
  resourceFee: number;
}

export interface TransactionResult {
  hash: string;
  feeEstimate: FeeEstimate | null;
}
```

`TransactionResult` is declared but no function in `stellarContract.ts` currently returns it:
write functions return `Promise<string>` (the transaction hash). Simulations return
`FeeEstimate | null`. Amount arguments are `bigint` stroops encoded as
`nativeToScVal(amount, { type: 'i128' })`, and addresses as `new Address(publicKey).toScVal()`.

### Signing callback

`stellarContract.ts` does not import Freighter. Applications provide `signTx`; the implementation
in
[`StellarWalletContext.tsx`](../Dechat/dex_with_fiat_frontend/src/contexts/StellarWalletContext.tsx)
calls Freighter's `signTransaction(xdr, { networkPassphrase, address })` and returns
`result.signedTxXdr`. Reuse that callback for any of the examples below.

```typescript
type SignTx = (xdr: string) => Promise<string>;
```

### Read-only calls and their limitation

The private `viewCall<T>(functionName: string)` simulates a no-argument contract call with
`DUMMY_SOURCE`, decodes `result.retval` with `scValToNative`, and caches the result for 10 seconds.
It accepts **no arguments**. The only argument-bearing view call implemented in
`stellarContract.ts` is `getAccruedFees(tokenAddress)`, which duplicates the simulation with
`contract.call('get_accrued_fees', new Address(tokenAddress).toScVal())`.

Consequently, argument-taking getters such as `get_token_config(token)`,
`get_multisig_proposal(id)`, `get_operator_nonce(operator)`, and `is_denied(address)` cannot be
called with any currently exported helper. Documenting them accurately would require adding a new
argument-aware view helper; no such helper exists today.

## 1. Token registration (`register_token`)

Contract signature ([source](../Dechat/stellar-contracts/src/lib.rs#L2330)):

```rust
pub fn register_token(
    env: Env,
    token: Address,
    limit: i128,
    daily_limit: i128,
) -> Result<(), Error> {
```

- `token` — the token contract address to register. It cannot be the bridge contract's own address.
- `limit` — per-transaction limit in stroops; must be greater than zero and at most the configured
  limit max cap.
- `daily_limit` — daily deposit limit in stroops; must be non-negative and not exceed `limit`.
- Requires admin authorization (`require_admin`) and emits `TokenRegisteredEvent`. Re-registering
  an existing token returns `TokenAlreadyRegistered`.

Using the repository's transaction pattern (no exported wrapper exists for this function):

```typescript
import { Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';
import { CONTRACT_ID } from '@/lib/stellarContract';
// buildAndSimulate and submitAndWait are private helpers in stellarContract.ts;
// in an integration you would add equivalent helpers or use the same SDK calls inline.

async function registerToken(
  adminPublicKey: string,
  tokenAddress: string,
  limitStroops: bigint,
  dailyLimitStroops: bigint,
  signTx: (xdr: string) => Promise<string>,
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'register_token',
    new Address(tokenAddress).toScVal(),
    nativeToScVal(limitStroops, { type: 'i128' }),
    nativeToScVal(dailyLimitStroops, { type: 'i128' }),
  );
  const { assembledXdr } = await buildAndSimulate(adminPublicKey, op);
  return submitAndWait(await signTx(assembledXdr));
}
```

The contract returns `Result<(), Error>`, so there is no value to decode after confirmation; the
application receives only the transaction hash. To inspect a registered token you would call
`get_token_config(token)`, but as noted above there is no argument-aware view helper in the
current TypeScript SDK. See the [token lifecycle section of
`FIAT_BRIDGE_README.md`](../Dechat/stellar-contracts/FIAT_BRIDGE_README.md).

## 2. Withdrawal requests (`request_withdrawal`)

Contract signature ([source](../Dechat/stellar-contracts/src/lib.rs#L1736)):

```rust
pub fn request_withdrawal(
    env: Env,
    to: Address,
    amount: i128,
    token: Address,
    memo_hash: Option<BytesN<32>>,
    risk_tier: u32,
) -> Result<u64, Error> {
```

Flow in Stellar-Dex-Chat:

1. Admin authorization is required, the contract must not be paused, and the circuit breaker must
   be clear.
2. `amount` must be positive; the recipient must not be denylisted; cooldown and anti-sandwich
   rules apply at execution time.
3. The request is stored in the withdrawal queue with `unlock_ledger`, `queued_ledger`, and
   `risk_tier`, and liability is recorded.
4. The function returns a unique `u64` request ID. Keep it: `execute_withdrawal(request_id,
   partial_amount, expected_price, max_slippage, nonce)`, `cancel_withdrawal(request_id)`, and
   `reclaim_expired_withdrawal(request_id)` all identify the request by this ID.
5. Queue depth can be read today with the exported [`getWithdrawalQueueDepth()`](../Dechat/dex_with_fiat_frontend/src/lib/stellarContract.ts#L412),
   which converts `get_wq_depth` to a `number`.

```typescript
import { Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';
import { CONTRACT_ID } from '@/lib/stellarContract';

async function requestWithdrawal(
  adminPublicKey: string,
  recipient: string,
  tokenAddress: string,
  amountStroops: bigint,
  riskTier: number,
  signTx: (xdr: string) => Promise<string>,
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'request_withdrawal',
    new Address(recipient).toScVal(),
    nativeToScVal(amountStroops, { type: 'i128' }),
    new Address(tokenAddress).toScVal(),
    nativeToScVal(null), // Option<BytesN<32>> = None; see limitation below
    nativeToScVal(riskTier, { type: 'u32' }),
  );
  const { assembledXdr } = await buildAndSimulate(adminPublicKey, op);
  return submitAndWait(await signTx(assembledXdr));
}

// Read the queue depth using the function that IS exported today.
import { getWithdrawalQueueDepth } from '@/lib/stellarContract';
const depth = await getWithdrawalQueueDepth();
```

**Return-value limitation.** The contract returns the new request ID as `u64`, but every
state-changing wrapper in `stellarContract.ts` returns only the transaction hash; no code decodes
a write call's `retval`. To obtain the ID from source inspection you would need to decode the
simulation result with `scValToNative` (as `viewCall` does for read-only calls) before submission,
or query the contract with an argument-aware getter. Neither behavior is implemented in the
checked-in SDK, so the example above cannot print the ID. Similarly, encoding a `Some(memo_hash)`
or the `Option` value has no precedent in this repository's TypeScript code; `nativeToScVal(null)`
is the Soroban `None` convention, but confirm it against your SDK version before use.

See [`WithdrawRequest`](../Dechat/stellar-contracts/src/lib.rs#L178), the [WQ glossary
entry](glossary.md#wq-withdrawal-queue), and `execute_withdrawal` in
[`lib.rs`](../Dechat/stellar-contracts/src/lib.rs#L1927) for the full flow.

## 3. Multisig proposals

The contract uses `propose_multisig_action` / `approve_multisig_action` /
`execute_multisig_action` — there is no `create_multisig_proposal` or `approve_multisig_proposal`
function. Signatures ([source](../Dechat/stellar-contracts/src/lib.rs#L6007)):

```rust
pub fn propose_multisig_action(
    env: Env,
    proposer: Address,
    action: BatchAdminOp,
) -> Result<u64, Error> { ... }

pub fn approve_multisig_action(env: Env, signer: Address, id: u64) -> Result<(), Error> { ... }
pub fn revoke_multisig_approval(env: Env, signer: Address, id: u64) -> Result<(), Error> { ... }
pub fn execute_multisig_action(env: Env, id: u64) -> Result<(), Error> { ... }
pub fn get_multisig_proposal(env: Env, id: u64) -> Option<MultisigProposal> { ... }
pub fn get_multisig_signers(env: Env) -> Vec<Address> { ... }
pub fn get_multisig_threshold(env: Env) -> u32 { ... }
```

A proposal is a [`MultisigProposal`](../Dechat/stellar-contracts/src/lib.rs#L169) containing
`creator`, `action: BatchAdminOp`, `approvals`, `executed`, and `created_at`. The proposer's
approval is recorded automatically. Each additional signer calls `approve_multisig_action`;
`execute_multisig_action` recounts approvals against the active signer set and requires the stored
threshold, then runs the action with multisig privileges and removes the proposal. Proposals
expire after `MULTISIG_PROPOSAL_EXPIRY` ledgers. Signer rotation is performed by a matured
proposal whose action is `"update_multisig"`; the direct
[`update_multisig`](../Dechat/stellar-contracts/src/lib.rs#L6250) function always returns
`Unauthorized`.

Supported `BatchAdminOp` symbols are documented in
[`BATCH_OPERATIONS.md`](../Dechat/stellar-contracts/docs/BATCH_OPERATIONS.md) and
`execute_single_admin_op_internal`: `"set_cooldown"`, `"set_lock"`, `"set_quota"`,
`"set_sandwich"`, `"set_slippage_threshold"`, `"set_limit"`, `"pause"`, `"unpause"`, and
`"update_multisig"`. Payloads are byte arrays (for example, a 4-byte big-endian `u32` for
`"set_lock"` or a 16-byte big-endian `i128` for `"set_quota"`). Unknown symbols fail.

### Creating, approving, and executing

```typescript
import { Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';
import { CONTRACT_ID } from '@/lib/stellarContract';

// id/approve/execute follow the same simulate -> sign -> submit pattern as section 1.
async function approveProposal(
  signerPublicKey: string,
  proposalId: bigint,
  signTx: (xdr: string) => Promise<string>,
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'approve_multisig_action',
    new Address(signerPublicKey).toScVal(),
    nativeToScVal(proposalId, { type: 'u64' }),
  );
  const { assembledXdr } = await buildAndSimulate(signerPublicKey, op);
  return submitAndWait(await signTx(assembledXdr));
}

async function executeProposal(
  callerPublicKey: string,
  proposalId: bigint,
  signTx: (xdr: string) => Promise<string>,
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'execute_multisig_action',
    nativeToScVal(proposalId, { type: 'u64' }),
  );
  const { assembledXdr } = await buildAndSimulate(callerPublicKey, op);
  return submitAndWait(await signTx(assembledXdr));
}
```

**Proposal creation limitation.** `propose_multisig_action` takes a `BatchAdminOp` struct with
`op_type: Symbol` and `payload: Bytes`. There is no TypeScript type, struct builder, or example in
this repository for constructing that ScVal (no exported `BatchAdminOp`, and no `Symbol`/`Bytes`
encoding helpers in `stellarContract.ts`). The contract's Rust helpers
[`build_set_limit_op`](../Dechat/stellar-contracts/src/lib.rs#L6270) and
[`build_update_multisig_op`](../Dechat/stellar-contracts/src/lib.rs#L6258) build it on-chain in
Rust. A TypeScript creation snippet would therefore have to introduce new ScVal encoding code
that is not present in this repository; this guide does not fabricate it. The approval and
execution calls above use only argument types already exercised by the SDK (`Address` and `u64`).

Handling results: all three calls return only the confirmed transaction hash in this SDK. The
contract returns a `u64` proposal ID from `propose_multisig_action`, but nothing decodes it. Errors
surface as thrown `Error` objects from simulation, submission, or `pollTransaction`; the current
SDK does not map contract error codes to named errors. Events such as `MultisigProposedEvent`,
`MultisigApprovedEvent`, and `MultisigExecutedEvent` are documented in
[`EVENTS.md`](../Dechat/stellar-contracts/docs/EVENTS.md).

## 4. Existing and refreshed contract functionality

### Deposits and legacy withdrawals

The current `deposit` signature has seven user arguments, while the TypeScript helper passes only
two:

```rust
pub fn deposit(
    env: Env, from: Address, amount: i128, token: Address,
    reference: Bytes, expected_price: i128, max_slippage: u32,
    memo_hash: Option<BytesN<32>>,
) -> Result<BytesN<32>, Error> { ... }
```

```typescript
// stellarContract.ts (current, verified by inspection)
export async function depositToContract(
  publicKey: string,
  amount: bigint,
  signTx: (xdr: string) => Promise<string>,
  onHashKnown?: (hash: string) => void,
): Promise<string>
```

`depositToContract` and `simulateDeposit` call `contract.call('deposit', address, i128)`;
`withdrawFromContract` and `simulateWithdraw` call `contract.call('withdraw', recipient, i128)`,
while the contract's `withdraw` takes `caller, to, amount, token`. Similarly, `getContractBalance()`
calls `viewCall('get_balance')`, but no `get_balance` entry point exists in the current contract.
These mismatches are documented here rather than hidden: do not assume the existing wrappers match
the Rust API, and verify any integration against the deployed WASM before relying on it. Use
`request_withdrawal` (section 2) for the current withdrawal-queue flow.

### Circuit breaker and pause

There are no `activate`/`deactivate` functions. The relevant entry points are in
[`lib.rs`](../Dechat/stellar-contracts/src/lib.rs#L2620):

```rust
pub fn pause(env: Env) -> Result<(), Error> { ... }
pub fn unpause(env: Env) -> Result<(), Error> { ... }
pub fn set_circuit_breaker_threshold(env: Env, threshold: i128) -> Result<(), Error> { ... }
pub fn set_circuit_breaker_reset_window(env: Env, ledgers: u32) -> Result<(), Error> { ... }
pub fn reset_circuit_breaker(env: Env) -> Result<(), Error> { ... }
pub fn is_circuit_breaker_tripped(env: Env) -> bool { ... }
pub fn get_config_snapshot(env: Env) -> Result<ConfigSnapshot, Error> { ... }
```

The older `get_circuit_breaker_threshold` and `get_circuit_breaker_reset_window` getters are
deprecated in favor of `get_config_snapshot`. `heartbeat` is blocked while the circuit breaker is
tripped. There is no TypeScript wrapper for any of these functions;
`ConfigSnapshot` includes `paused`, `circuit_breaker_threshold`,
`circuit_breaker_reset_window`, `multisig_threshold`, and `anti_sandwich_delay` fields.

### Emergency recovery

```rust
pub fn set_emergency_recovery(env: Env, recovery: Address, cap: i128) -> Result<(), Error> { ... }
pub fn get_emergency_recovery_cap(env: Env) -> Option<i128> { ... }
pub fn get_emergency_recovery_address(env: Env) -> Option<Address> { ... }
pub fn trigger_emergency_recovery(env: Env) -> Result<(), Error> { ... }
```

Source: [`lib.rs`](../Dechat/stellar-contracts/src/lib.rs#L6345). Eligibility uses the configured
inactivity threshold (`set_inactivity_threshold` / `get_inactivity_threshold`) and the last admin
action ledger. No TypeScript wrapper exists for these calls.

### Heartbeat and operator nonce

```rust
pub fn heartbeat(env: Env, operator: Address, nonce: u64) -> Result<(), Error> { ... }
```

The contract requires the operator's authorization, checks that the address is an active operator,
and consumes the exact next nonce (`get_operator_nonce`). Reusing a nonce fails with `StaleNonce`;
skipping ahead fails with `InvalidNonce`. There is no `submitHeartbeat` or `getOperatorNonce`
function in the TypeScript SDK, and no mapping from those Rust errors to TypeScript messages —
the older examples that showed such wrappers were illustrative only. A call would follow the same
`contract.call('heartbeat', new Address(operator).toScVal(), nativeToScVal(nonce, { type: 'u64'
}))` pattern, but it must be implemented locally.

### Denylist, escrow migration, and batch admin

`deny_address(address)`, `remove_denied_address(address)`, `is_denied(address)`,
`migrate_escrow(batch_size: u32) -> Result<u32, Error>`, and
`execute_batch_admin(operations: Vec<BatchAdminOp>) -> Result<BatchResult, Error>` all exist in the
contract. None has a TypeScript wrapper. Note that the older example used `"deny_address"` as a
batch admin operation; that symbol is **not** supported by `execute_single_admin_op_internal` and
would fail. `BatchResult` contains `total_ops`, `success_count`, `failure_count`, and
`failed_index`; the contract does not guarantee all operations succeed, so inspect counts and
failed indexes from emitted events. See
[`BATCH_OPERATIONS.md`](../Dechat/stellar-contracts/docs/BATCH_OPERATIONS.md) and
[`VERSION_MIGRATION.md`](../Dechat/stellar-contracts/docs/VERSION_MIGRATION.md).

### Error codes

Use [`lib.rs`](../Dechat/stellar-contracts/src/lib.rs#L51) as the authoritative error enum (also
mirrored in [`ERROR_CODES.md`](../Dechat/stellar-contracts/ERROR_CODES.md)). Relevant current
values include `CooldownActive = 307`, `AntiSandwichDelayActive = 308`,
`TokenNotWhitelisted = 309`, `AddressDenied = 310`, `MigrationAlreadyComplete = 802`,
`InvalidNonce = 901`, and `StaleNonce = 902`. `BatchOperationFailed = 803` is deprecated/unused.
The TypeScript SDK currently throws generic `Error` objects, so error names must be matched from
the simulation error text if needed.

## Best practices

1. Verify the deployed WASM matches the contract revision you are coding against; functions and
   signatures change.
2. Set `NEXT_PUBLIC_*` values before building, and never place secrets in them.
3. Use `bigint` stroops with `nativeToScVal(..., { type: 'i128' })` to avoid precision loss.
4. Read operator nonces immediately before signing nonce-protected actions.
5. Treat transaction hashes as the only result currently returned by write wrappers; do not
   assume a decoded return value.
6. Handle simulation failures, submission failures, and `pollTransaction` timeouts separately.
7. Use `pollTransaction` (exported) rather than duplicating polling logic.
8. Consult the [Testing Guide](testing.md) for running unit/E2E/contract tests locally; no network
   snippets were run as part of this documentation update.
