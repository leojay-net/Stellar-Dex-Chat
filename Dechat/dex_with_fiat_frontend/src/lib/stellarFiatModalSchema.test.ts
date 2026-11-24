import { describe, it, expect } from 'vitest';
import {
  contractRecipientSchema,
  STELLAR_FIAT_RISK_CONFIRMATION_PHRASE,
  validateStellarFiatModalForm,
} from './stellarFiatModalSchema';

const VALID_G_ADDRESS =
  'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const VALID_M_ADDRESS =
  'MAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAAAAAAAAAAAAFQGI';

describe('validateStellarFiatModalForm', () => {
  it('rejects invalid amount for deposit', () => {
    expect(
      validateStellarFiatModalForm({
        isAdminMode: false,
        amount: '-1',
        recipient: '',
        note: '',
        riskConfirmation: '',
        isRiskyAmount: false,
      }),
    ).toBeTruthy();
  });

  it('requires exact risk phrase when amount is risky', () => {
    expect(
      validateStellarFiatModalForm({
        isAdminMode: false,
        amount: '600',
        recipient: '',
        note: '',
        riskConfirmation: 'wrong',
        isRiskyAmount: true,
      }),
    ).toBeTruthy();

    expect(
      validateStellarFiatModalForm({
        isAdminMode: false,
        amount: '600',
        recipient: '',
        note: '',
        riskConfirmation: STELLAR_FIAT_RISK_CONFIRMATION_PHRASE.toLowerCase(),
        isRiskyAmount: true,
      }),
    ).toBeNull();
  });

  it('rejects invalid Stellar public key in withdraw mode', () => {
    expect(
      validateStellarFiatModalForm({
        isAdminMode: true,
        amount: '10',
        recipient: 'not-a-key',
        note: '',
        riskConfirmation: '',
        isRiskyAmount: false,
      }),
    ).toMatch(/Recipient|Stellar|public key/i);
  });

  it('allows empty recipient in withdraw mode (self)', () => {
    expect(
      validateStellarFiatModalForm({
        isAdminMode: true,
        amount: '10',
        recipient: '   ',
        note: 'x',
        riskConfirmation: '',
        isRiskyAmount: false,
      }),
    ).toBeNull();
  });

  it('accepts a plain G... address as recipient in admin mode', () => {
    expect(
      validateStellarFiatModalForm({
        isAdminMode: true,
        amount: '10',
        recipient: VALID_G_ADDRESS,
        note: '',
        riskConfirmation: '',
        isRiskyAmount: false,
      }),
    ).toBeNull();
  });

  it('accepts a muxed M... address as recipient in admin mode', () => {
    expect(
      validateStellarFiatModalForm({
        isAdminMode: true,
        amount: '10',
        recipient: VALID_M_ADDRESS,
        note: '',
        riskConfirmation: '',
        isRiskyAmount: false,
      }),
    ).toBeNull();
  });

  it('rejects a muxed M... address in fields that require a plain G... key', () => {
    const result = contractRecipientSchema.safeParse(VALID_M_ADDRESS);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/G…|muxed/i);
  });

  it('contractRecipientSchema accepts a plain G... address', () => {
    expect(contractRecipientSchema.safeParse(VALID_G_ADDRESS).success).toBe(
      true,
    );
  });
});
