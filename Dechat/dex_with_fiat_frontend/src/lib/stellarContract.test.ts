import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  computeLedgerCountdown,
  formatDurationSeconds,
  normalizeUpgradeProposal,
  normalizeUpgradeProposalTiming,
} from './stellarContract';

describe('bytesToHex', () => {
  it('converts a Uint8Array to lowercase hex', () => {
    expect(bytesToHex(new Uint8Array([0xab, 0x01, 0xff]))).toBe('ab01ff');
  });

  it('converts a number array to hex', () => {
    expect(bytesToHex([0x00, 0x10, 0x7f])).toBe('00107f');
  });

  it('passes through a string unchanged (lowercased)', () => {
    expect(bytesToHex('AB12CD')).toBe('ab12cd');
  });
});

describe('normalizeUpgradeProposal', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeUpgradeProposal(null)).toBeNull();
    expect(normalizeUpgradeProposal(undefined)).toBeNull();
  });

  it('normalizes a raw proposal object', () => {
    const raw = {
      wasm_hash: new Uint8Array(32).fill(0x11),
      executable_after: 123456,
      new_version: 7,
    };
    expect(normalizeUpgradeProposal(raw)).toEqual({
      wasmHash: '11'.repeat(32),
      executableAfterLedger: 123456,
      newVersion: 7,
    });
  });

  it('returns null when required fields are missing', () => {
    expect(normalizeUpgradeProposal({ new_version: 3 })).toBeNull();
    expect(normalizeUpgradeProposal({})).toBeNull();
  });
});

describe('normalizeUpgradeProposalTiming', () => {
  it('returns null for null input', () => {
    expect(normalizeUpgradeProposalTiming(null)).toBeNull();
  });

  it('normalizes timing metadata', () => {
    const raw = {
      wasm_hash: [0xaa],
      proposed_at: 100,
      delay: 50,
      executable_after: 150,
    };
    expect(normalizeUpgradeProposalTiming(raw)).toEqual({
      wasmHash: 'aa',
      proposedAtLedger: 100,
      delayLedgers: 50,
      executableAfterLedger: 150,
    });
  });
});

describe('computeLedgerCountdown', () => {
  it('reports remaining ledgers and seconds', () => {
    expect(computeLedgerCountdown(200, 100)).toEqual({
      remainingLedgers: 100,
      remainingSeconds: 500,
      executable: false,
    });
  });

  it('is executable when the target ledger is reached or passed', () => {
    expect(computeLedgerCountdown(100, 100).executable).toBe(true);
    expect(computeLedgerCountdown(100, 150).executable).toBe(true);
    expect(computeLedgerCountdown(100, 150).remainingLedgers).toBe(0);
  });
});

describe('formatDurationSeconds', () => {
  it('formats sub-minute durations', () => {
    expect(formatDurationSeconds(0)).toBe('0s');
    expect(formatDurationSeconds(45)).toBe('45s');
  });

  it('formats minutes', () => {
    expect(formatDurationSeconds(125)).toBe('2m 5s');
  });

  it('formats hours and days', () => {
    expect(formatDurationSeconds(3700)).toBe('1h 1m');
    expect(formatDurationSeconds(90000)).toBe('1d 1h');
  });
});
