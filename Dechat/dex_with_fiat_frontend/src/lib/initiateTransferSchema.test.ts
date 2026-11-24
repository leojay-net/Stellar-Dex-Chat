import { describe, expect, it } from 'vitest';
import { initiateTransferSchema, MAX_TRANSFER_AMOUNT_NGN } from './apiSchemas';

const transfer = (amount: number) =>
  initiateTransferSchema.safeParse({
    source: 'balance',
    amount,
    recipient: 'RCP_test',
  });

describe('initiateTransferSchema amount validation', () => {
  it('accepts integer and two-decimal NGN amounts, including float artifacts', () => {
    expect(transfer(1234.56).success).toBe(true);
    expect(transfer(0.1 + 0.2).success).toBe(true);
  });

  it('rejects amounts with more than two decimal places', () => {
    expect(transfer(1234.567).success).toBe(false);
  });

  it('enforces the configured maximum transfer amount', () => {
    expect(transfer(MAX_TRANSFER_AMOUNT_NGN).success).toBe(true);
    expect(transfer(MAX_TRANSFER_AMOUNT_NGN + 0.01).success).toBe(false);
    expect(transfer(Number.MAX_VALUE).success).toBe(false);
  });
});
