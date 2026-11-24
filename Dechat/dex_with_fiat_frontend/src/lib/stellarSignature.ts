import { verify, xdr } from '@stellar/stellar-sdk';

/**
 * Verifies that a signature was created by the given Stellar address for the given message.
 *
 * @param message - The message that was signed (as a string)
 * @param signature - The signature as a base64-encoded string
 * @param publicKey - The Stellar public key that should have signed the message
 * @returns Promise<boolean> - True if the signature is valid, false otherwise
 */
export async function verifySignature(
  message: string,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const messageBuffer = Buffer.from(message);
    const signatureBuffer = Buffer.from(signature, 'base64');
    const publicKeyBuffer = Buffer.from(publicKey);

    const isValid = verify(messageBuffer, signatureBuffer, publicKeyBuffer);

    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Verifies that a signed transaction XDR contains the expected nonce in its memo
 * and is signed by the given public key.
 *
 * @param signedXdr - The signed transaction XDR
 * @param expectedNonce - The nonce that should be in the transaction memo (base64)
 * @param publicKey - The Stellar public key that should have signed the transaction
 * @returns Promise<boolean> - True if the signature is valid and nonce matches, false otherwise
 */
export async function verifySignedTransaction(
  signedXdr: string,
  expectedNonce: string,
  publicKey: string,
): Promise<boolean> {
  try {
    // Parse the XDR envelope
    const envelope = xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64');

    // Get transaction and signatures based on envelope type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tx: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let signatures: any;

    const envelopeType = envelope.switch();
    if (envelopeType === xdr.EnvelopeType.envelopeTypeTxV0()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v0 = envelope as any;
      tx = v0.tx();
      signatures = v0.signatures();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v1 = envelope as any;
      tx = v1.tx();
      signatures = v1.signatures();
    }

    // Verify the nonce in the memo
    const memo = tx.memo();
    if (!memo || memo.switch() === xdr.MemoType.memoNone()) {
      console.error('Transaction has no memo');
      return false;
    }

    // The nonce should be in the memo hash (32 bytes)
    let nonceFromTx: string;
    if (memo.switch() === xdr.MemoType.memoHash()) {
      const memoHash = memo.value();
      nonceFromTx = Buffer.from(memoHash).toString('base64');
    } else {
      console.error('Memo is not a hash type');
      return false;
    }

    if (nonceFromTx !== expectedNonce) {
      console.error('Nonce mismatch in transaction memo');
      return false;
    }

    // Verify the signature
    if (!signatures || signatures.length === 0) {
      console.error('Transaction has no signature');
      return false;
    }

    const signature = signatures[0];
    const signatureBuffer = Buffer.from(signature);

    // Get the transaction hash (the payload that was signed)
    const txHash = tx.hash();

    // Verify the signature
    const publicKeyBuffer = Buffer.from(publicKey);
    const isValid = verify(txHash, signatureBuffer, publicKeyBuffer);

    if (!isValid) {
      console.error('Signature verification failed');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Transaction verification error:', error);
    return false;
  }
}
