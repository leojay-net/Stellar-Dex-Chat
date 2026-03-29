import { z } from 'zod';

const serverSchema = z.object({
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYOUT_PROVIDER: z.string().default('paystack'),
  ADMIN_API_TOKEN: z.string().optional(),
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
      process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT,
    NEXT_PUBLIC_XLM_SAC_CONTRACT: process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT,
    NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_GEMINI_API_KEY: process.env.NEXT_PUBLIC_GEMINI_API_KEY,
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
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
      PAYOUT_PROVIDER: process.env.PAYOUT_PROVIDER,
      ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
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
