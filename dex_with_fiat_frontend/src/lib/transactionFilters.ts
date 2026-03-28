import type {
  TransactionHistoryEntry,
  FilterState,
  FilterStats,
  FilterOption,
} from '@/types';

/**
 * Filters transactions based on the provided filter state.
 * Applies AND logic between categories and OR logic within categories.
 *
 * @param transactions - Array of transaction history entries to filter
 * @param filterState - Current filter state with selected values per category
 * @returns Filtered array of transactions
 */
export function filterTransactions(
  transactions: TransactionHistoryEntry[],
  filterState: FilterState,
): TransactionHistoryEntry[] {
  // Early exit if no filters are active
  if (
    filterState.status.length === 0 &&
    filterState.asset.length === 0 &&
    filterState.network.length === 0
  ) {
    return transactions;
  }

  return transactions.filter((tx) => {
    // AND logic between categories
    const statusMatch =
      filterState.status.length === 0 || filterState.status.includes(tx.status);

    const assetMatch =
      filterState.asset.length === 0 ||
      (tx.asset !== undefined && filterState.asset.includes(tx.asset));

    // Network field doesn't exist in TransactionHistoryEntry yet, but we'll support it
    const networkMatch =
      filterState.network.length === 0 ||
      ('network' in tx &&
        typeof tx.network === 'string' &&
        filterState.network.includes(tx.network));

    return statusMatch && assetMatch && networkMatch;
  });
}

/**
 * Computes filter statistics including available options and counts.
 *
 * @param transactions - Array of all transaction history entries
 * @param filterState - Current filter state
 * @returns Filter statistics with options and counts
 */
export function computeFilterStats(
  transactions: TransactionHistoryEntry[],
  filterState: FilterState,
): FilterStats {
  // Count transactions by status
  const statusCounts = new Map<string, number>();
  const assetCounts = new Map<string, number>();
  const networkCounts = new Map<string, number>();

  transactions.forEach((tx) => {
    // Count status
    statusCounts.set(tx.status, (statusCounts.get(tx.status) || 0) + 1);

    // Count asset
    if (tx.asset) {
      assetCounts.set(tx.asset, (assetCounts.get(tx.asset) || 0) + 1);
    }

    // Count network (if available)
    if ('network' in tx && typeof tx.network === 'string') {
      networkCounts.set(tx.network, (networkCounts.get(tx.network) || 0) + 1);
    }
  });

  // Convert to FilterOption arrays
  const statusOptions: FilterOption[] = Array.from(statusCounts.entries())
    .map(([value, count]) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const assetOptions: FilterOption[] = Array.from(assetCounts.entries())
    .map(([value, count]) => ({
      value,
      label: value,
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const networkOptions: FilterOption[] = Array.from(networkCounts.entries())
    .map(([value, count]) => ({
      value,
      label: formatNetworkLabel(value),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Compute filtered count
  const filteredTransactions = filterTransactions(transactions, filterState);

  return {
    statusOptions,
    assetOptions,
    networkOptions,
    totalCount: transactions.length,
    filteredCount: filteredTransactions.length,
  };
}

/**
 * Formats network identifier into a human-readable label.
 *
 * @param network - Network identifier
 * @returns Formatted label
 */
function formatNetworkLabel(network: string): string {
  // Convert kebab-case or snake_case to Title Case
  return network
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
