import type { FilterState, TransactionStatus } from '@/types';

const VALID_STATUSES: TransactionStatus[] = [
  'pending',
  'completed',
  'warning',
  'failed',
  'cancelled',
];

/**
 * Serializes filter state to URL query parameters.
 *
 * @param filterState - Current filter state
 * @returns URLSearchParams object with filter parameters
 */
export function serializeFilters(filterState: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filterState.status.length > 0) {
    params.set('status', filterState.status.join(','));
  }
  if (filterState.asset.length > 0) {
    params.set('asset', filterState.asset.join(','));
  }
  if (filterState.network.length > 0) {
    params.set('network', filterState.network.join(','));
  }

  return params;
}

/**
 * Deserializes URL query parameters to filter state.
 *
 * @param searchParams - URLSearchParams object from URL
 * @returns FilterState object
 */
export function deserializeFilters(searchParams: URLSearchParams): FilterState {
  return {
    status: parseFilterParam(
      searchParams.get('status'),
      VALID_STATUSES,
    ) as TransactionStatus[],
    asset: parseFilterParam(searchParams.get('asset')),
    network: parseFilterParam(searchParams.get('network')),
  };
}

/**
 * Parses a comma-separated filter parameter value.
 *
 * `URLSearchParams.get` has already percent-decoded the value, so the entries
 * are only trimmed and length-checked here. Decoding again is what made a
 * shared link such as `?asset=100%25` throw `URIError: URI malformed` on the
 * second pass and crash the transaction filter view.
 *
 * @param param - Raw parameter value from URL
 * @param validValues - Optional array of valid values for validation
 * @returns Array of parsed and validated filter values
 */
function parseFilterParam(
  param: string | null,
  validValues?: readonly string[],
): string[] {
  if (!param) return [];

  const values = param
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  if (validValues) {
    return values.filter((v) => validValues.includes(v));
  }

  return values;
}

/**
 * Merges filter parameters with existing URL search params, preserving non-filter params.
 *
 * @param currentParams - Current URLSearchParams
 * @param filterState - Filter state to serialize
 * @returns New URLSearchParams with merged parameters
 */
export function mergeFilterParams(
  currentParams: URLSearchParams,
  filterState: FilterState,
): URLSearchParams {
  const newParams = new URLSearchParams(currentParams);

  // Remove existing filter params
  newParams.delete('status');
  newParams.delete('asset');
  newParams.delete('network');

  // Add new filter params
  const filterParams = serializeFilters(filterState);
  filterParams.forEach((value, key) => {
    newParams.set(key, value);
  });

  return newParams;
}
