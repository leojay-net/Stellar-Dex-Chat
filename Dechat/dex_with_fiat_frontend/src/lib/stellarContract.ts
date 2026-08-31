import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
  Horizon,
} from '@stellar/stellar-sdk';
import { stroopsToXlm } from '@/lib/stroops';
import { env } from '@/lib/env';

export { stroopsToXlm as stroopsToDisplay } from '@/lib/stroops';

const RPC_URL =
  env.NEXT_PUBLIC_STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
export const CONTRACT_ID =
  env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT ||
  'CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR';
// XLM SAC address — the token used by the bridge (stored on-chain after init)
export const XLM_SAC_ID =
  env.NEXT_PUBLIC_XLM_SAC_CONTRACT ||
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Stellar Testnet passphrase — switch to Networks.PUBLIC for mainnet
const NETWORK_PASSPHRASE = Networks.TESTNET;

export const BRIDGE_LIMIT_WARNING_PERCENT = 80;

// Dummy source account used for simulating read-only contract calls.
// This is a well-known Stellar Foundation testnet account and does not
// need to be funded — it's only used as a valid source when building
// transactions for contract view simulations.
export const DUMMY_SOURCE =
  'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW';

/**
 * FeeEstimate describes estimated network and resource fees returned by transaction simulation.
 *
 * `minFee` is represented as a string of raw stroops to avoid JavaScript `BigInt` JSON serialization
 * issues across client-server boundaries, while `fee`, `baseFee`, and `resourceFee` are converted
 * to fractional XLM numbers strictly for UI display purposes.
 */
export interface FeeEstimate {
  /** Total minimum fee in raw stroops as a string (base fee + Soroban resource fee). */
  minFee: string;
  /** Total fee in decimal XLM for UI presentation. */
  fee: number;
  /** Fixed base network inclusion fee in XLM. */
  baseFee: number;
  /** Dynamic Soroban WASM resource consumption fee in XLM. */
  resourceFee: number;
}

const server = new rpc.Server(RPC_URL, { allowHttp: false });

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
  (RPC_URL.includes('testnet')
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org');
const horizonServer = new Horizon.Server(HORIZON_URL);

// ── Helpers ───────────────────────────────────────────────────────────────

// Simple in-memory TTL cache for view calls
const CACHE_TTL_SECONDS = 10;
const cache = new Map<string, { value: unknown; expires: number }>();

export function getCachedValue<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) {
    console.log('cache miss', key);
    return undefined;
  }
  if (Date.now() > entry.expires) {
    cache.delete(key);
    console.log('cache miss', key);
    return undefined;
  }
  console.log('cache hit', key);
  return entry.value as T;
}

export function setCachedValue(key: string, value: unknown) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

export function clearCache() {
  cache.clear();
  console.log('cache cleared');
}

// Expose debug helpers on window in browser for manual testing (dev only)
declare global {
  interface Window {
    clearBridgeCache: typeof clearCache;
    getBridgeLimit: () => Promise<bigint>;
    getContractBalance: () => Promise<bigint>;
    getTotalDeposited: () => Promise<bigint>;
    getWithdrawalQueueDepth: () => Promise<number>;
  }
}

try {
  if (typeof window !== 'undefined') {
    window.clearBridgeCache = clearCache;
    window.getBridgeLimit = async () => getBridgeLimit();
    window.getContractBalance = async () => getContractBalance();
    window.getTotalDeposited = async () => getTotalDeposited();
    window.getWithdrawalQueueDepth = async () => getWithdrawalQueueDepth();
  }
} catch {
  // ignore
}

/**
 * Builds, simulates, and assembles a Soroban transaction XDR.
 *
 * Evaluates resource footprint, checks for contract execution errors, and calculates
 * exact stroop fees using `BigInt` addition (`resourceFeeInStroops + baseFeeInStroops`).
 *
 * @param publicKey - The source account's Stellar public key.
 * @param operation - The contract invocation operation.
 * @returns Object containing the assembled transaction XDR and fee estimates.
 */
async function buildAndSimulate(
  publicKey: string,
  operation: ReturnType<Contract['call']>,
): Promise<{ assembledXdr: string; feeEstimate: FeeEstimate | null }> {
  const account = await server.getAccount(publicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }

  let feeEstimate: FeeEstimate | null = null;
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (successSim.minResourceFee !== undefined) {
    const resourceFeeInStroops = BigInt(successSim.minResourceFee);
    const baseFeeInStroops = BigInt(BASE_FEE);
    const totalFeeInStroops = resourceFeeInStroops + baseFeeInStroops;

    feeEstimate = {
      minFee: totalFeeInStroops.toString(),
      fee: Number(totalFeeInStroops) / 10_000_000,
      baseFee: Number(baseFeeInStroops) / 10_000_000,
      resourceFee: Number(resourceFeeInStroops) / 10_000_000,
    };
  }

  return {
    assembledXdr: rpc.assembleTransaction(tx, sim).build().toXDR(),
    feeEstimate,
  };
}

export async function pollTransaction(
  hash: string,
  maxRetries: number = 20,
): Promise<string> {
  let getResult = await server.getTransaction(hash);
  let retries = 0;
  while (getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (retries >= maxRetries) {
      throw new Error(
        `Transaction confirmation timed out after ${maxRetries} attempts`,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
    retries += 1;
    getResult = await server.getTransaction(hash);
  }
  if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error('Transaction failed on-chain');
  }
  return hash;
}

/** Submit a signed XDR and wait for confirmation. */
async function submitAndWait(
  signedXdr: string,
  onHashKnown?: (hash: string) => void,
  maxRetries: number = 20,
): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Submission failed: ${JSON.stringify(sendResult.errorResult)}`,
    );
  }
  onHashKnown?.(sendResult.hash);
  return pollTransaction(sendResult.hash, maxRetries);
}

// ── Write functions (require wallet signature) ────────────────────────────

export interface TransactionResult {
  hash: string;
  feeEstimate: FeeEstimate | null;
}

/**
 * Simulates a deposit transaction to estimate gas and resource fees without broadcasting.
 *
 * @param publicKey - The depositor's Stellar public key.
 * @param amount - Deposit amount in stroops as a `bigint` (encoded into Soroban `i128`).
 * @returns Estimated fees or `null` if simulation details were omitted.
 * @throws {Error} If `amount` exceeds the configured on-chain bridge limit or simulation reverts.
 */
export async function simulateDeposit(
  publicKey: string,
  amount: bigint,
): Promise<FeeEstimate | null> {
  await validateBridgeAmountLimit(amount);
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'deposit',
    new Address(publicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  const { feeEstimate } = await buildAndSimulate(publicKey, op);
  return feeEstimate;
}

/**
 * Simulates an administrative withdrawal to estimate transaction fees.
 *
 * @param adminPublicKey - Authorized admin public key.
 * @param recipientPublicKey - Recipient destination public key.
 * @param amount - Withdrawal amount in stroops as a `bigint`.
 * @returns Estimated fees or `null`.
 */
export async function simulateWithdraw(
  adminPublicKey: string,
  recipientPublicKey: string,
  amount: bigint,
): Promise<FeeEstimate | null> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'withdraw',
    new Address(recipientPublicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  const { feeEstimate } = await buildAndSimulate(adminPublicKey, op);
  return feeEstimate;
}

/**
 * Deposits `amount` stroops of the bridged token from `publicKey` into the smart contract.
 *
 * The `amount` parameter is passed as a `bigint` directly to `nativeToScVal(..., { type: 'i128' })`,
 * guaranteeing zero floating-point precision loss and avoiding `Number.MAX_SAFE_INTEGER` overflow.
 *
 * @param publicKey - The depositor's public key.
 * @param amount - Amount to deposit in stroops as a `bigint`.
 * @param signTx - Callback to request wallet signature on the assembled XDR.
 * @param onHashKnown - Optional callback invoked once the transaction hash is generated.
 * @returns The confirmed on-chain transaction hash.
 */
export async function depositToContract(
  publicKey: string,
  amount: bigint,
  signTx: (xdr: string) => Promise<string>,
  onHashKnown?: (hash: string) => void,
): Promise<string> {
  await validateBridgeAmountLimit(amount);
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'deposit',
    new Address(publicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  const { assembledXdr } = await buildAndSimulate(publicKey, op);
  const signed = await signTx(assembledXdr);
  const hash = await submitAndWait(signed, onHashKnown);
  clearCache();
  return hash;
}

/**
 * Admin withdraws `amount` stroops from the contract to `recipientPublicKey`.
 * Only the admin key can authorise this call.
 */
export async function withdrawFromContract(
  adminPublicKey: string,
  recipientPublicKey: string,
  amount: bigint,
  signTx: (xdr: string) => Promise<string>,
  onHashKnown?: (hash: string) => void,
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'withdraw',
    new Address(recipientPublicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  const { assembledXdr } = await buildAndSimulate(adminPublicKey, op);
  const signed = await signTx(assembledXdr);
  const hash = await submitAndWait(signed, onHashKnown);
  clearCache();
  return hash;
}

// ── Read-only view calls (no signature needed) ────────────────────────────

/** Simulate a read-only contract call and return the decoded return value. */
async function viewCall<T>(functionName: string): Promise<T> {
  // Check in-memory cache first
  const cached = getCachedValue<T>(functionName);
  if (cached !== undefined) {
    return cached;
  }
  // Use a dummy account (Stellar Foundation's well-known testnet account) for cls
  const contract = new Contract(CONTRACT_ID);

  // We don't need a funded account — just a valid one for building the tx
  let account;
  try {
    account = await server.getAccount(DUMMY_SOURCE);
  } catch {
    // If testnet doesn't know the account, create a skeleton account object
    const { Account } = await import('@stellar/stellar-sdk');
    account = new Account(DUMMY_SOURCE, '0');
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(functionName))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`View call failed: ${sim.error}`);
  }
  const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result
    ?.retval;
  if (!retval) throw new Error('No return value');
  const result = scValToNative(retval) as T;
  setCachedValue(functionName, result);
  return result;
}

/** Returns the current token balance (in stroops) held by the bridge contract. */
export async function getContractBalance(): Promise<bigint> {
  return viewCall<bigint>('get_balance');
}

/**
 * Returns the authorized admin address of the contract.
 * 
 * @returns {Promise<string>} The Stellar public key of the current admin.
 * 
 * **Authentication Architecture:**
 * The bridge contract stores the admin address in its instance storage.
 * All sensitive administrative operations (e.g., withdrawals, setting limits)
 * require the transaction to be signed by this exact address. This function
 * fetches the current state directly from the blockchain to ensure front-end
 * routing and UI states accurately reflect the source of truth.
 */
export async function getAdmin(): Promise<string> {
  return viewCall<string>('get_admin');
}

/** Returns the per-deposit limit set by the admin. */
export async function getBridgeLimit(): Promise<bigint> {
  return viewCall<bigint>('get_limit');
}

/**
 * Validates that the requested transaction amount in stroops does not exceed the on-chain bridge limit.
 *
 * Evaluates `amount > limit` strictly in `BigInt` space to prevent overflow or truncation.
 *
 * @param amount - The transaction amount in stroops as a `bigint`.
 * @returns The active bridge limit in stroops.
 * @throws {Error} If `amount` exceeds the configured bridge limit.
 */
export async function validateBridgeAmountLimit(
  amount: bigint,
): Promise<bigint> {
  const limit = await getBridgeLimit();

  if (amount > limit) {
    throw new Error(
      `Requested amount exceeds the current bridge limit of ${stroopsToXlm(limit)} XLM.`,
    );
  }

  return limit;
}

/** Returns the running total of all deposits ever made. */
export async function getTotalDeposited(): Promise<bigint> {
  return viewCall<bigint>('get_total_deposited');
}

export async function getWithdrawalQueueDepth(): Promise<number> {
  const value = await viewCall<bigint | number>('get_wq_depth');
  return Number(value);
}

/** Returns the accrued fees for the specified token. */
export async function getAccruedFees(tokenAddress: string): Promise<bigint> {
  // Check in-memory cache first
  const functionName = `get_accrued_fees:${tokenAddress}`;
  const cached = getCachedValue<bigint>(functionName);
  if (cached !== undefined) {
    return cached;
  }

  const contract = new Contract(CONTRACT_ID);
  let account;
  try {
    account = await server.getAccount(DUMMY_SOURCE);
  } catch {
    const { Account } = await import('@stellar/stellar-sdk');
    account = new Account(DUMMY_SOURCE, '0');
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call('get_accrued_fees', new Address(tokenAddress).toScVal()),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`View call failed: ${sim.error}`);
  }
  const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result
    ?.retval;
  if (!retval) throw new Error('No return value');
  const result = scValToNative(retval) as bigint;
  setCachedValue(functionName, result);
  return result;
}

/** Fetches the native XLM balance for the given public key. Returns empty string on failure. */
export async function fetchXlmBalance(publicKey: string): Promise<string> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const native = account.balances.find(
      (b: Horizon.HorizonApi.BalanceLine): b is Horizon.HorizonApi.BalanceLineNative =>
        b.asset_type === 'native',
    );
    return native ? parseFloat(native.balance).toFixed(2) : '0.00';
  } catch {
    return '';
  }
}
