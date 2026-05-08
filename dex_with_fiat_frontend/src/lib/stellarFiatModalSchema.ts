import { z } from 'zod';

/** Must match typed confirmation in `StellarFiatModal` for large transfers. */
export const STELLAR_FIAT_RISK_CONFIRMATION_PHRASE = 'CONFIRM LARGE AMOUNT';

/** Stellar StrKey public account (56 chars, base32 subset). */
const STELLAR_ACCOUNT_KEY = /^G[A-Z2-7]{55}$/;

const amountStringSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .refine((s) => {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) && n > 0;
  }, 'Amount must be a positive number');

const noteSchema = z.string().max(160, 'Note must be at most 160 characters');

const adminRecipientSchema = z
  .string()
  .trim()
  .refine(
    (s) => s === '' || STELLAR_ACCOUNT_KEY.test(s),
    'Recipient must be empty (self) or a valid Stellar public key',
  );

const riskConfirmationSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.literal(STELLAR_FIAT_RISK_CONFIRMATION_PHRASE));

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
    })
    .safeParse({
      amount: input.amount,
      note: input.note,
      riskConfirmation: input.riskConfirmation,
    });
  if (!r.success) {
    return (
      r.error.issues[0]?.message ??
      `Type "${STELLAR_FIAT_RISK_CONFIRMATION_PHRASE}" to confirm this large transfer.`
    );
  }
  return null;
}
