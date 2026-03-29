import { z } from 'zod';

// Schema for create-recipient endpoint
export const createRecipientSchema = z.object({
  type: z.string().min(1, 'Type is required'),
  name: z.string().min(1, 'Name is required'),
  account_number: z.string().min(1, 'Account number is required'),
  bank_code: z.string().min(1, 'Bank code is required'),
  currency: z.string().min(1, 'Currency is required'),
});

export type CreateRecipientInput = z.infer<typeof createRecipientSchema>;

// Schema for initiate-transfer endpoint
export const initiateTransferSchema = z.object({
  source: z.string().min(1, 'Source is required'),
  reason: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  recipient: z.string().min(1, 'Recipient is required'),
  reference: z.string().optional(),
});

export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>;

// Schema for verify-account endpoint
export const verifyAccountSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required'),
  bankCode: z.string().min(1, 'Bank code is required'),
});

export type VerifyAccountInput = z.infer<typeof verifyAccountSchema>;
