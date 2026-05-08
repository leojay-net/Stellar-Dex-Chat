import { describe, it, expect } from 'vitest';
import {
  STELLAR_FIAT_RISK_CONFIRMATION_PHRASE,
  validateStellarFiatModalForm,
} from './stellarFiatModalSchema';

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
});
