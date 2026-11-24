import { z } from 'zod';
import { isValidPublicKey, isValidRecipientAddress } from './stellarAddress';

/** Must match typed confirmation in `StellarFiatModal` for large transfers. */
export const STELLAR_FIAT_RISK_CONFIRMATION_PHRASE = 'CONFIRM LARGE AMOUNT';

const amountStringSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .refine((s) => {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) && n > 0;
  }, 'Amount must be a positive number');

const noteSchema = z.string().max(160, 'Note must be at most 160 characters');

/**
 * Admin recipient: accepts an empty string (send-to-self), a plain `G...`
 * account, or a muxed `M...` account.  Plain Soroban contract calls that
 * require a `G...` key must use `contractRecipientSchema` instead.
 */
const adminRecipientSchema = z
  .string()
  .trim()
  .refine(
    (s) => s === '' || isValidRecipientAddress(s),
    'Recipient must be empty (self), a valid Stellar public key (G…), or a muxed account address (M…)',
  );

/**
 * Contract recipient: accepts only a plain `G...` account key.
 * Use where the Soroban contract rejects muxed addresses.
 */
export const contractRecipientSchema = z
  .string()
  .trim()
  .refine(
    (s) => isValidPublicKey(s),
    'Contract recipient must be a plain Stellar public key (G…); muxed addresses (M…) are not accepted here',
  );

const riskConfirmationSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.literal(STELLAR_FIAT_RISK_CONFIRMATION_PHRASE));

const twoFactorConfirmationSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 4, 'Enter at least 4 characters');

/**
 * Validates modal fields before building a Soroban transaction.
 * Returns the first user-facing error message, or `null` when valid.
 */
export function validateStellarFiatModalForm(input: {
  isAdminMode: boolean;
  amount: string;
  recipient: string;
  note: string;
  riskConfirmation: string;
  isRiskyAmount: boolean;
  twoFactorConfirmation?: string;
}): string | null {
  if (input.isAdminMode) {
    const r = z
      .object({
        amount: amountStringSchema,
        recipient: adminRecipientSchema,
        note: noteSchema,
      })
      .safeParse({
        amount: input.amount,
        recipient: input.recipient,
        note: input.note,
      });
    if (!r.success) {
      return r.error.issues[0]?.message ?? 'Invalid input';
    }
    return null;
  }

  if (!input.isRiskyAmount) {
    const r = z
      .object({
        amount: amountStringSchema,
        note: noteSchema,
      })
      .safeParse({
        amount: input.amount,
        note: input.note,
      });
    if (!r.success) {
      return r.error.issues[0]?.message ?? 'Invalid input';
    }
    return null;
  }

  const r = z
    .object({
      amount: amountStringSchema,
      note: noteSchema,
      riskConfirmation: riskConfirmationSchema,
      twoFactorConfirmation: input.twoFactorConfirmation
        ? twoFactorConfirmationSchema
        : z.string().optional(),
    })
    .safeParse({
      amount: input.amount,
      note: input.note,
      riskConfirmation: input.riskConfirmation,
      twoFactorConfirmation: input.twoFactorConfirmation,
    });
  if (!r.success) {
    return (
      r.error.issues[0]?.message ??
      `Type "${STELLAR_FIAT_RISK_CONFIRMATION_PHRASE}" to confirm this large transfer.`
    );
  }
  return null;
}
