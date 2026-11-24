import { describe, expect, it } from 'vitest';
import {
  decodeMuxedAddress,
  formatRecipientAddress,
  isValidMuxedAddress,
  isValidPublicKey,
  isValidRecipientAddress,
  toBaseAccount,
} from './stellarAddress';

// Encoded 32-byte public-key fixture generated with the Stellar SDK.
const VALID_G_ADDRESS =
  'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';

// A real muxed address derived from the base account above with id=1.
const VALID_M_ADDRESS =
  'MAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAAAAAAAAAAAAFQGI';

describe('isValidPublicKey', () => {
  it('accepts a valid G... address', () => {
    expect(isValidPublicKey(VALID_G_ADDRESS)).toBe(true);
  });

  it('rejects a muxed M... address', () => {
    expect(isValidPublicKey(VALID_M_ADDRESS)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidPublicKey('')).toBe(false);
  });

  it('rejects a truncated address', () => {
    expect(isValidPublicKey('GABC')).toBe(false);
  });

  it('rejects an address with invalid characters', () => {
    expect(isValidPublicKey('G' + '0'.repeat(55))).toBe(false);
  });
});

describe('isValidMuxedAddress', () => {
  it('accepts a valid M... address', () => {
    expect(isValidMuxedAddress(VALID_M_ADDRESS)).toBe(true);
  });

  it('rejects a plain G... address', () => {
    expect(isValidMuxedAddress(VALID_G_ADDRESS)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidMuxedAddress('')).toBe(false);
  });

  it('rejects arbitrary text', () => {
    expect(isValidMuxedAddress('not-an-address')).toBe(false);
  });
});

describe('isValidRecipientAddress', () => {
  it('accepts a valid G... address', () => {
    expect(isValidRecipientAddress(VALID_G_ADDRESS)).toBe(true);
  });

  it('accepts a valid M... address', () => {
    expect(isValidRecipientAddress(VALID_M_ADDRESS)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidRecipientAddress('')).toBe(false);
  });

  it('rejects arbitrary text', () => {
    expect(isValidRecipientAddress('not-an-address')).toBe(false);
  });
});

describe('decodeMuxedAddress', () => {
  it('decodes a valid M... address into base account and id', () => {
    const parts = decodeMuxedAddress(VALID_M_ADDRESS);
    expect(parts).not.toBeNull();
    expect(parts!.baseAccount).toBe(VALID_G_ADDRESS);
    expect(parts!.muxedId).toBe(1n);
  });

  it('returns null for a plain G... address', () => {
    expect(decodeMuxedAddress(VALID_G_ADDRESS)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeMuxedAddress('')).toBeNull();
  });

  it('returns null for arbitrary text', () => {
    expect(decodeMuxedAddress('not-an-address')).toBeNull();
  });
});

describe('toBaseAccount', () => {
  it('returns the address unchanged for a plain G... key', () => {
    expect(toBaseAccount(VALID_G_ADDRESS)).toBe(VALID_G_ADDRESS);
  });

  it('extracts the base G... account from a muxed M... address', () => {
    expect(toBaseAccount(VALID_M_ADDRESS)).toBe(VALID_G_ADDRESS);
  });

  it('returns null for an empty string', () => {
    expect(toBaseAccount('')).toBeNull();
  });

  it('returns null for arbitrary text', () => {
    expect(toBaseAccount('not-an-address')).toBeNull();
  });
});

describe('formatRecipientAddress', () => {
  it('returns a G... address unchanged', () => {
    expect(formatRecipientAddress(VALID_G_ADDRESS)).toBe(VALID_G_ADDRESS);
  });

  it('formats a muxed M... address as "<base> (id: <id>)"', () => {
    const formatted = formatRecipientAddress(VALID_M_ADDRESS);
    expect(formatted).toContain(VALID_G_ADDRESS);
    expect(formatted).toContain('id: 1');
  });

  it('returns arbitrary text unchanged', () => {
    expect(formatRecipientAddress('not-an-address')).toBe('not-an-address');
  });
});
