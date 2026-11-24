import 'server-only';
import { z } from 'zod';
import { clientEnv, formatErrors } from './clientEnv';

export const serverSchema = z.object({
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYOUT_PROVIDER: z.string().default('paystack'),
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  ADMIN_IP_ALLOWLIST_BYPASS_LOCAL: z.preprocess((value: unknown) => {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }, z.boolean().default(false)),
  ADMIN_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
});

const processServerEnvVars = () => {
  const serverVars = {
    PAYSTACK_SECRET_KEY:
      typeof process !== 'undefined'
        ? process.env.PAYSTACK_SECRET_KEY
        : undefined,
    PAYOUT_PROVIDER:
      typeof process !== 'undefined' ? process.env.PAYOUT_PROVIDER : undefined,
    ADMIN_IP_ALLOWLIST:
      typeof process !== 'undefined'
        ? process.env.ADMIN_IP_ALLOWLIST
        : undefined,
    ADMIN_IP_ALLOWLIST_BYPASS_LOCAL:
      typeof process !== 'undefined'
        ? process.env.ADMIN_IP_ALLOWLIST_BYPASS_LOCAL
        : undefined,
    ADMIN_SECRET:
      typeof process !== 'undefined' ? process.env.ADMIN_SECRET : undefined,
    GEMINI_API_KEY:
      typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined,
  };

  const parsed = serverSchema.safeParse(serverVars);

  if (!parsed.success) {
    console.error(
      '❌ Invalid server environment variables:\n',
      formatErrors(parsed.error.format()),
    );
    throw new Error('Invalid server environment variables');
  }

  return { ...clientEnv, ...parsed.data };
};

export const serverEnv = processServerEnvVars();
