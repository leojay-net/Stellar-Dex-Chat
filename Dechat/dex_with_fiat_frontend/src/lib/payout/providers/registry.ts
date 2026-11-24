import type { PayoutProvider, PayoutProviderName } from './types';
import { paystackProvider } from './paystackProvider';
import { serverEnv as env } from '@/lib/serverEnv';

const providers: Record<PayoutProviderName, PayoutProvider> = {
  paystack: paystackProvider,
};

export function getPayoutProvider(name?: string): PayoutProvider {
  const providerName = (name ||
    env.PAYOUT_PROVIDER ||
    'paystack') as PayoutProviderName;

  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unsupported payout provider: ${providerName}`);
  }

  return provider;
}
