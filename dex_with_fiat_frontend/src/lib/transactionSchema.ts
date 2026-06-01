import { z } from 'zod';

export const transactionAmountSchema = z.object({
  amount: z.union([
    z.number().positive('Amount must be positive'),
    z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: 'Amount must be a positive number',
    }),
  ]),
  asset: z.string().min(1, 'Asset is required').default('XLM'),
  fiatAmount: z.union([z.string(), z.number()]).optional(),
  fiatCurrency: z.string().optional(),
});

export type TransactionAmountProps = z.infer<typeof transactionAmountSchema>;
