import type { FilterState, TransactionStatus } from '@/types';

const VALID_STATUSES: TransactionStatus[] = [
  'pending',
  'completed',
  'warning',
  'failed',
  'cancelled',
];

const JSON_LIST_PREFIX = '~json~';

export interface FilterValidationOptions {
  asset?: readonly string[];
  network?: readonly string[];
}

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
    params.set('asset', serializeFilterValues(filterState.asset));
  }
  if (filterState.network.length > 0) {
    params.set('network', serializeFilterValues(filterState.network));
  }

  return params;
}

/**
 * Deserializes URL query parameters to filter state.
 *
 * @param searchParams - URLSearchParams object from URL
 * @returns FilterState object
 */
export function deserializeFilters(
  searchParams: URLSearchParams,
  validOptions: FilterValidationOptions = {},
): FilterState {
  return {
    status: parseFilterParam(
      searchParams.get('status'),
      VALID_STATUSES,
    ) as TransactionStatus[],
    asset: parseFilterParam(searchParams.get('asset'), validOptions.asset),
    network: parseFilterParam(
      searchParams.get('network'),
      validOptions.network,
    ),
  };
}

function serializeFilterValues(values: readonly string[]): string {
  return values.some((value) => value.includes(','))
    ? `${JSON_LIST_PREFIX}${JSON.stringify(values)}`
    : values.join(',');
}

/**
 * Parses a filter parameter value, accepting legacy comma-separated links.
 *
 * `URLSearchParams.get` has already percent-decoded the value. New values
 * containing commas use a JSON-prefixed representation; legacy links remain
 * comma-separated.
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

  let parsedValues: string[];
  if (param.startsWith(JSON_LIST_PREFIX)) {
    try {
      const decoded: unknown = JSON.parse(param.slice(JSON_LIST_PREFIX.length));
      parsedValues = Array.isArray(decoded)
        ? decoded.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  } else {
    parsedValues = param.split(',');
  }

  const values = parsedValues.map((v) => v.trim()).filter((v) => v.length > 0);

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
