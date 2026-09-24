import { describe, expect, it } from 'vitest';

import {
  deserializeFilters,
  mergeFilterParams,
  serializeFilters,
} from './filterUrlSerializer';
import type { FilterState } from '@/types';

const emptyState: FilterState = { status: [], asset: [], network: [] };

describe('serializeFilters', () => {
  it('writes every non-empty facet as a comma-separated value', () => {
    const params = serializeFilters({
      status: ['pending', 'failed'],
      asset: ['USDC'],
      network: ['testnet'],
    });

    expect(params.get('status')).toBe('pending,failed');
    expect(params.get('asset')).toBe('USDC');
    expect(params.get('network')).toBe('testnet');
  });

  it('omits empty facets instead of writing blank parameters', () => {
    const params = serializeFilters({ ...emptyState, status: ['pending'] });

    expect(params.toString()).toBe('status=pending');
    expect(params.has('asset')).toBe(false);
    expect(params.has('network')).toBe(false);
  });
});

describe('deserializeFilters', () => {
  it('reads comma-separated values back', () => {
    const params = new URLSearchParams(
      'status=pending,failed&asset=USDC,XLM&network=testnet',
    );

    expect(deserializeFilters(params)).toEqual({
      status: ['pending', 'failed'],
      asset: ['USDC', 'XLM'],
      network: ['testnet'],
    });
  });

  it('drops statuses that are not part of the known set', () => {
    const params = new URLSearchParams('status=pending,bogus,completed');

    expect(deserializeFilters(params).status).toEqual(['pending', 'completed']);
  });

  it('splits a value that itself contains a comma, which the format cannot escape', () => {
    // ',' is both the separator and a legal character inside a value, and
    // URLSearchParams.get decodes the whole parameter before this module sees
    // it, so the two cases are indistinguishable here. Every value the UI can
    // produce today is a token without a comma (asset codes, network names,
    // statuses), so this is a documented edge of the format rather than a
    // reachable defect. Escaping it would mean changing the link format.
    const params = new URLSearchParams('asset=XLM%2CDEX');

    expect(params.get('asset')).toBe('XLM,DEX');
    expect(deserializeFilters(params).asset).toEqual(['XLM', 'DEX']);
  });

  it('does not throw when a value contains a literal percent sign', () => {
    // A shared link such as `?asset=100%25` is already decoded to "100%" by
    // URLSearchParams.get; the extra decodeURIComponent pass raised
    // "URIError: URI malformed" and took the filter view down.
    const params = new URLSearchParams('asset=100%25&network=50%25');

    expect(deserializeFilters(params).asset).toEqual(['100%']);
    expect(deserializeFilters(params).network).toEqual(['50%']);
  });

  it('never throws on the malformed percent sequences a hand-written link can contain', () => {
    for (const raw of [
      'asset=%',
      'asset=a%zz',
      'network=%%%',
      'asset=%E0%A4%A',
    ]) {
      expect(() => deserializeFilters(new URLSearchParams(raw))).not.toThrow();
    }
  });

  it('returns empty arrays for missing, empty and whitespace-only values', () => {
    expect(deserializeFilters(new URLSearchParams(''))).toEqual(emptyState);
    expect(
      deserializeFilters(new URLSearchParams('status=&asset=')).status,
    ).toEqual([]);
    expect(
      deserializeFilters(new URLSearchParams('asset=%20%20')).asset,
    ).toEqual([]);
  });

  it('removes the empty entries produced by stray commas', () => {
    const params = new URLSearchParams('asset=USDC,,XLM,&network=,testnet');

    expect(deserializeFilters(params).asset).toEqual(['USDC', 'XLM']);
    expect(deserializeFilters(params).network).toEqual(['testnet']);
  });

  it('keeps duplicate values as separate entries', () => {
    const params = new URLSearchParams('asset=USDC,USDC');

    expect(deserializeFilters(params).asset).toEqual(['USDC', 'USDC']);
  });

  it('round-trips a filter state through both directions', () => {
    const state: FilterState = {
      status: ['pending', 'completed'],
      asset: ['USDC'],
      network: ['testnet'],
    };

    expect(deserializeFilters(serializeFilters(state))).toEqual(state);
  });
});

describe('mergeFilterParams', () => {
  it('preserves unrelated search params', () => {
    const merged = mergeFilterParams(
      new URLSearchParams('tab=history&status=warning'),
      { status: ['pending'], asset: ['USDC'], network: [] },
    );

    expect(merged.get('tab')).toBe('history');
    expect(merged.get('status')).toBe('pending');
    expect(merged.get('asset')).toBe('USDC');
  });

  it('removes facets that are no longer selected', () => {
    const merged = mergeFilterParams(
      new URLSearchParams('status=pending&asset=USDC&network=testnet'),
      { ...emptyState, status: ['failed'] },
    );

    expect(merged.get('status')).toBe('failed');
    expect(merged.has('asset')).toBe(false);
    expect(merged.has('network')).toBe(false);
  });

  it('round-trips through deserializeFilters while keeping other params', () => {
    const state: FilterState = {
      status: ['failed'],
      asset: [],
      network: ['mainnet'],
    };
    const merged = mergeFilterParams(new URLSearchParams('tab=history'), state);

    expect(deserializeFilters(merged)).toEqual(state);
    expect(merged.get('tab')).toBe('history');
  });
});
