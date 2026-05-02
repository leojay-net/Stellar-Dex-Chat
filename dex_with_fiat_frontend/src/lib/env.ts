import { z } from 'zod';

const serverSchema = z.object({
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYOUT_PROVIDER: z.string().default('paystack'),
  ADMIN_API_TOKEN: z.string().optional(),
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  ADMIN_IP_ALLOWLIST_BYPASS_LOCAL: z.preprocess((value: unknown) => {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }, z.boolean().default(false)),
  ADMIN_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT: z
    .string()
    .default('CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR'),
  NEXT_PUBLIC_XLM_SAC_CONTRACT: z
    .string()
    .default('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'),
  NEXT_PUBLIC_STELLAR_RPC_URL: z
    .string()
    .default('https://soroban-testnet.stellar.org'),
  NEXT_PUBLIC_GEMINI_API_KEY: z.string().optional(),
});

const formatErrors = (
  errors: z.ZodFormattedError<Map<string, string>, string>,
) =>
  Object.entries(errors)
    .map(([name, value]) => {
      if (value && '_errors' in value && value._errors.length) {
        return `${name}: ${value._errors.join(', ')}`;
      }
      return null;
    })
    .filter(Boolean)
    .join('\n');

const processEnvVars = () => {
  const isServer = typeof window === 'undefined';

  const clientVars = {
    NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT:
      (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT : undefined),
    NEXT_PUBLIC_XLM_SAC_CONTRACT: (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT : undefined),
    NEXT_PUBLIC_STELLAR_RPC_URL: (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_STELLAR_RPC_URL : undefined),
    NEXT_PUBLIC_GEMINI_API_KEY: (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_GEMINI_API_KEY : undefined),
  };

  const parsedClient = clientSchema.safeParse(clientVars);

  if (!parsedClient.success) {
    console.error(
      '❌ Invalid client environment variables:\n',
      formatErrors(parsedClient.error.format()),
    );
    throw new Error('Invalid client environment variables');
  }

  if (isServer) {
    const serverVars = {
      PAYSTACK_SECRET_KEY: (typeof process !== 'undefined' ? process.env.PAYSTACK_SECRET_KEY : undefined),
      PAYOUT_PROVIDER: (typeof process !== 'undefined' ? process.env.PAYOUT_PROVIDER : undefined),
      ADMIN_API_TOKEN: (typeof process !== 'undefined' ? process.env.ADMIN_API_TOKEN : undefined),
      ADMIN_IP_ALLOWLIST: (typeof process !== 'undefined' ? process.env.ADMIN_IP_ALLOWLIST : undefined),
      ADMIN_IP_ALLOWLIST_BYPASS_LOCAL: (typeof process !== 'undefined' ? process.env.ADMIN_IP_ALLOWLIST_BYPASS_LOCAL : undefined),
      ADMIN_SECRET: (typeof process !== 'undefined' ? process.env.ADMIN_SECRET : undefined),
      GEMINI_API_KEY: (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined),
    };

    const parsedServer = serverSchema.safeParse(serverVars);

    if (!parsedServer.success) {
      console.error(
        '❌ Invalid server environment variables:\n',
        formatErrors(parsedServer.error.format()),
      );
      throw new Error('Invalid server environment variables');
    }

    return { ...parsedClient.data, ...parsedServer.data };
  }

  return parsedClient.data as typeof parsedClient.data &
    z.infer<typeof serverSchema>;
};

export const env = processEnvVars();
