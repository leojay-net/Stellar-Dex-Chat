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

const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  'https://soroban-testnet.stellar.org';
const CONTRACT_ID =
  process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT ||
  'CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR';
// XLM SAC address — the token used by the bridge (stored on-chain after init)
export const XLM_SAC_ID =
  process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT ||
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Stellar Testnet passphrase — switch to Networks.PUBLIC for mainnet
const NETWORK_PASSPHRASE = Networks.TESTNET;

export const BRIDGE_LIMIT_WARNING_PERCENT = 80;

const server = new rpc.Server(RPC_URL, { allowHttp: false });

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build, simulate, and assemble a transaction. Returns the assembled XDR. */
async function buildAndSimulate(
  publicKey: string,
  operation: ReturnType<Contract['call']>,
): Promise<string> {
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
  return rpc.assembleTransaction(tx, sim).build().toXDR();
}

/** Submit a signed XDR and wait for confirmation. */
async function submitAndWait(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Submission failed: ${JSON.stringify(sendResult.errorResult)}`,
    );
  }

  // Poll until finalized
  let getResult = await server.getTransaction(sendResult.hash);
  while (getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
  }
  if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error('Transaction failed on-chain');
  }
  return sendResult.hash;
}

// ── Write functions (require wallet signature) ────────────────────────────

/**
 * Deposit `amount` stroops of the bridged token from `publicKey` into the contract.
 * Returns the transaction hash on success.
 */
export async function depositToContract(
  publicKey: string,
  amount: bigint,
  signTx: (xdr: string) => Promise<string>,
): Promise<string> {
  await validateBridgeAmountLimit(amount);
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'deposit',
    new Address(publicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  const assembled = await buildAndSimulate(publicKey, op);
  const signed = await signTx(assembled);
  return submitAndWait(signed);
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
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  const op = contract.call(
    'withdraw',
    new Address(recipientPublicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  const assembled = await buildAndSimulate(adminPublicKey, op);
  const signed = await signTx(assembled);
  return submitAndWait(signed);
}

// ── Read-only view calls (no signature needed) ────────────────────────────

/** Simulate a read-only contract call and return the decoded return value. */
async function viewCall<T>(functionName: string): Promise<T> {
  // Use a dummy account (Stellar Foundation's well-known testnet account) for simulation
  const DUMMY_SOURCE =
    'GBEFLW6RTALNHCL7HW2INWB4ASHZ7E6MF6E2IOIIMBVEAU2B2B4XLRQW';
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
  return scValToNative(retval) as T;
}

/** Returns the current token balance (in stroops) held by the bridge contract. */
export async function getContractBalance(): Promise<bigint> {
  return viewCall<bigint>('get_balance');
}

/** Returns the per-deposit limit set by the admin. */
export async function getBridgeLimit(): Promise<bigint> {
  return viewCall<bigint>('get_limit');
}

export async function validateBridgeAmountLimit(amount: bigint): Promise<bigint> {
  const limit = await getBridgeLimit();

  if (amount > limit) {
    throw new Error(
      `Requested amount exceeds the current bridge limit of ${stroopsToDisplay(limit)} XLM.`,
    );
  }

  return limit;
}

/** Returns the running total of all deposits ever made. */
export async function getTotalDeposited(): Promise<bigint> {
  return viewCall<bigint>('get_total_deposited');
}

/** Formats a raw stroop (1e-7 XLM) bigint as a human-readable string. */
export function stroopsToDisplay(stroops: bigint, decimals = 7): string {
  const divisor = BigInt(10 ** decimals);
  const whole = stroops / divisor;
  const frac = stroops % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
