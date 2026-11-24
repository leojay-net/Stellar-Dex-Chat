import { MuxedAccount, StrKey } from '@stellar/stellar-sdk';

/** A plain `G...` Stellar account address (56 base-32 chars). */
export type StellarPublicKey = string & {
  readonly __brand: 'StellarPublicKey';
};

/** A muxed `M...` Stellar account address. */
export type MuxedAccountAddress = string & {
  readonly __brand: 'MuxedAccountAddress';
};

/** Either a plain `G...` or a muxed `M...` address. */
export type StellarRecipientAddress = StellarPublicKey | MuxedAccountAddress;

/** Returns true for a valid plain `G...` account key. */
export function isValidPublicKey(address: string): address is StellarPublicKey {
  return StrKey.isValidEd25519PublicKey(address);
}

/** Returns true for a valid muxed `M...` account address. */
export function isValidMuxedAddress(
  address: string,
): address is MuxedAccountAddress {
  return StrKey.isValidMed25519PublicKey(address);
}

/** Returns true for any valid Stellar recipient address (`G...` or `M...`). */
export function isValidRecipientAddress(
  address: string,
): address is StellarRecipientAddress {
  return isValidPublicKey(address) || isValidMuxedAddress(address);
}

export interface MuxedAddressParts {
  /** The underlying `G...` base account. */
  baseAccount: StellarPublicKey;
  /** The numeric muxed-account id. */
  muxedId: bigint;
}

/**
 * Decodes a muxed `M...` address into its base `G...` account and numeric id.
 * Returns `null` when the input is not a valid muxed address.
 */
export function decodeMuxedAddress(address: string): MuxedAddressParts | null {
  if (!isValidMuxedAddress(address)) return null;
  try {
    const muxed = MuxedAccount.fromAddress(address, '0');
    return {
      baseAccount: muxed.baseAccount().accountId() as StellarPublicKey,
      muxedId: BigInt(muxed.id()),
    };
  } catch {
    return null;
  }
}

/**
 * Returns the base `G...` account for a recipient address.
 *
 * - For a plain `G...` key the input is returned unchanged.
 * - For a muxed `M...` address the underlying base account is extracted.
 * - Returns `null` when the input is neither.
 */
export function toBaseAccount(address: string): StellarPublicKey | null {
  if (isValidPublicKey(address)) return address as StellarPublicKey;
  const parts = decodeMuxedAddress(address);
  return parts ? parts.baseAccount : null;
}

/**
 * Formats a recipient address for display.
 *
 * - Plain `G...`: returned as-is.
 * - Muxed `M...`: returns `"<base> (id: <id>)"` so the UI can show both.
 * - Unknown: returned as-is.
 */
export function formatRecipientAddress(address: string): string {
  const parts = decodeMuxedAddress(address);
  if (parts) {
    return `${parts.baseAccount} (id: ${parts.muxedId})`;
  }
  return address;
}
