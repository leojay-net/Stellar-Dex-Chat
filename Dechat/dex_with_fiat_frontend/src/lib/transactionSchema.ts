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

/**
 * Props type is the schema's *input* type: `asset` carries a zod default
 * (`'XLM'`), so callers may omit it — the component's `parsed?.asset || 'XLM'`
 * fallback documents the same behaviour. Using `z.infer` (the output type)
 * wrongly required `asset`, which type-checking the tests exposed.
 */
export type TransactionAmountProps = z.input<typeof transactionAmountSchema>;
